import { Plugin, SettingsTypes, ContextMenuManager, EntityType } from "@ryelite/core";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.js";

// Action labels shown in the game's right-click menu.
const MARK_ACTION = "Mark tile";
const UNMARK_ACTION = "Unmark tile";

// DOM ids for the injected overlay layers and the create/edit panel.
const OVERLAY_ID = "tilemarkers-overlay";
const STYLE_ID = "tilemarkers-style";
const CREATE_PANEL_ID = "tilemarkers-create";

interface TileMarker {
    x: number;
    z: number;
    y: number;
    level: number;
    label: string;
    color: string;
}

export default class TileMarkers extends Plugin {
    pluginName = "TileMarkers";
    author = "matter";

    // ---- State --------------------------------------------------------------

    private isStarted = false;
    private markers: TileMarker[] = [];
    private cmm: ContextMenuManager = new ContextMenuManager();

    private overlayEl: HTMLDivElement | null = null;
    private svgEl: SVGSVGElement | null = null;
    private labelLayerEl: HTMLDivElement | null = null;
    private createPanelEl: HTMLDivElement | null = null;

    private renderObserver: any = null;
    private observedScene: any = null;

    private markActionNumber = -1;
    private unmarkActionNumber = -1;

    // Position + shift state of the most recent right-click. Recorded on
    // pointerdown (capture phase) because the game builds the context menu during
    // pointerdown — recording on the later 'contextmenu' event would leave the
    // menu hook reading the PREVIOUS click's values (off-by-one).
    private lastRightClickX = 0;
    private lastRightClickY = 0;
    private lastRightClickShift = false;

    // ---- Event handlers -----------------------------------------------------
    // Declared as arrow fields so `this` stays bound to the plugin: the framework
    // and DOM invoke these with their own (or no) `this`.

    // Freeze the right-click position/shift before the game builds its menu. Only
    // the right button updates it, so left-clicking a menu item keeps the position.
    private onPointerDownTracker = (e: PointerEvent) => {
        if (e.button !== 2) return;
        this.lastRightClickX = e.clientX;
        this.lastRightClickY = e.clientY;
        this.lastRightClickShift = e.shiftKey;
    };

    // Chains on the game's game-world context-menu builder. We take full control
    // of our two entries: strip any the framework auto-added (it only does so for
    // entities), then re-append exactly one — Mark or Unmark — but only when the
    // triggering right-click held Shift. Works on empty ground too, since this
    // runs on the raw menu method, not the framework's entity-only loop.
    private menuHook = (_args: any[], result: any, ctxInstance: any): any => {
        if (!Array.isArray(result)) return result;
        const out = result.filter(
            (it: any) => it?.Action !== this.markActionNumber && it?.Action !== this.unmarkActionNumber
        );
        if (!this.lastRightClickShift) return out;

        const factory = ctxInstance?._contextMenuItemFactory;
        if (!factory?.createGameWorldContextMenuItem) return out;

        const coords = this.deriveTileFromPointer();
        if (!coords) return out;

        const isMarked = this.findMarkerIndex(coords.x, coords.z, coords.level) >= 0;
        const actionNumber = isMarked ? this.unmarkActionNumber : this.markActionNumber;
        if (actionNumber < 0) return out;

        try {
            const handler = this.cmm.worldObjectActionHandler.bind(this.cmm, EntityType.Any);
            const item = factory.createGameWorldContextMenuItem(
                actionNumber, handler, null, null, null, null
            );
            if (item) out.push(item);
        } catch (err) {
            this.warn("createGameWorldContextMenuItem failed", err);
        }
        return out;
    };

    // Invoked when the user clicks our "Mark tile" menu entry.
    private handleMarkAction = () => {
        const coords = this.deriveTileFromPointer();
        if (!coords) {
            this.warn("could not derive tile coords for Mark tile");
            return;
        }
        const existingIdx = this.findMarkerIndex(coords.x, coords.z, coords.level);
        this.openCreatePanel(
            this.lastRightClickX,
            this.lastRightClickY,
            coords.x,
            coords.z,
            coords.y,
            coords.level,
            existingIdx
        );
    };

    // Invoked when the user clicks our "Unmark tile" menu entry.
    private handleUnmarkAction = () => {
        const coords = this.deriveTileFromPointer();
        if (!coords) {
            this.warn("could not derive tile coords for Unmark tile");
            return;
        }
        const idx = this.findMarkerIndex(coords.x, coords.z, coords.level);
        if (idx >= 0) this.removeMarker(idx);
    };

    // ---- Construction & lifecycle -------------------------------------------

    constructor() {
        super();

        this.settings.defaultColor = {
            text: "Default marker color",
            type: SettingsTypes.color,
            value: "#ffea00",
            callback: () => {},
        };
        this.settings.showLabels = {
            text: "Show labels above tiles",
            type: SettingsTypes.checkbox,
            value: true,
            callback: () => this.refreshLabelVisibility(),
        };
        this.settings.clearAll = {
            text: "Clear all markers",
            type: SettingsTypes.button,
            value: "Clear",
            callback: () => this.clearAllMarkers(),
        };
        // The field holds a JSON string of all markers. Copy it out to share or
        // back up; paste a string in to replace your markers.
        this.settings.importExport = {
            text: "Import/Export (copy to share, paste to load)",
            type: SettingsTypes.textarea,
            value: "",
            callback: () => this.onImportExportChanged(),
        };
    }

    init(): void {
        if (!Array.isArray(this.data.markers)) {
            this.data.markers = [];
        }
        this.markers = this.data.markers as TileMarker[];
    }

    start(): void {
        if (this.isStarted) return;
        this.isStarted = true;

        this.markers = Array.isArray(this.data.markers) ? this.data.markers : [];
        this.data.markers = this.markers;
        this.syncExportField();

        this.injectStyles();
        this.buildOverlay();

        window.addEventListener("pointerdown", this.onPointerDownTracker, true);

        // Register the two actions under EntityType.Any so their labels resolve in
        // the GameWorldActions lookup and their click handlers route through
        // worldObjectActionHandler(-1). Our menuHook controls when they actually
        // appear (Shift-gated); the framework's own auto-add is stripped there.
        try {
            this.markActionNumber = this.cmm.AddGameWorldMenuAction(
                MARK_ACTION, this.handleMarkAction, EntityType.Any
            );
            this.unmarkActionNumber = this.cmm.AddGameWorldMenuAction(
                UNMARK_ACTION, this.handleUnmarkAction, EntityType.Any
            );
        } catch (err) {
            this.warn("AddGameWorldMenuAction threw", err);
        }

        try {
            this.cmm.registerContextHook(
                "ContextMenuItemManager",
                "_createGameWorldContextMenuItems",
                this.menuHook
            );
        } catch (err) {
            this.warn("registerContextHook threw", err);
        }

        this.hookRenderLoop();

        this.log("TileMarkers started");
    }

    stop(): void {
        if (!this.isStarted) return;
        this.isStarted = false;

        window.removeEventListener("pointerdown", this.onPointerDownTracker, true);

        try {
            this.cmm.RemoveGameWorldMenuAction(MARK_ACTION, this.handleMarkAction, EntityType.Any);
            this.cmm.RemoveGameWorldMenuAction(UNMARK_ACTION, this.handleUnmarkAction, EntityType.Any);
        } catch (err) {
            this.warn("RemoveGameWorldMenuAction threw", err);
        }

        this.closeCreatePanel();

        if (this.renderObserver && this.observedScene?.onBeforeRenderObservable?.remove) {
            this.observedScene.onBeforeRenderObservable.remove(this.renderObserver);
        }
        this.renderObserver = null;
        this.observedScene = null;

        if (this.overlayEl?.parentNode) this.overlayEl.parentNode.removeChild(this.overlayEl);
        this.overlayEl = null;
        this.svgEl = null;
        this.labelLayerEl = null;

        const style = document.getElementById(STYLE_ID);
        if (style?.parentNode) style.parentNode.removeChild(style);

        this.log("TileMarkers stopped");
    }

    // ---- Game / scene accessors ---------------------------------------------

    private getEngine(): any {
        return this.gameHooks?.GameEngine?.Instance?.Engine ?? null;
    }

    private getScene(): any {
        return this.gameHooks?.GameEngine?.Instance?.Scene ?? null;
    }

    private getCamera(): any {
        return this.gameHooks?.GameCameraManager?.Camera ?? null;
    }

    private getRenderingCanvas(): HTMLCanvasElement | null {
        const engine = this.getEngine();
        return engine?.getRenderingCanvas?.() ?? null;
    }

    private getMainPlayer(): any {
        return this.gameHooks?.EntityManager?.Instance?.MainPlayer ?? null;
    }

    /**
     * The map level / plane the player is currently on, used to cull markers from
     * other levels. `_currentMapLevel` distinguishes surface vs underground (and
     * building floors); `_currentGamePosition._y` does NOT — it stays 0 across
     * surface and underground, so culling on it leaked markers between levels.
     */
    private getPlayerLevel(): number {
        const p = this.getMainPlayer();
        const lvl = p?._currentMapLevel ?? p?._currentGamePosition?._y;
        return typeof lvl === "number" ? lvl : 0;
    }

    // ---- Tile picking -------------------------------------------------------

    private deriveTileFromPointer(): { x: number; z: number; y: number; level: number } | null {
        const canvas = this.getRenderingCanvas();
        const scene = this.getScene();
        const camera = this.getCamera();
        if (!canvas || !scene || !camera) return null;

        const rect = canvas.getBoundingClientRect();
        const cx = this.lastRightClickX - rect.left;
        const cy = this.lastRightClickY - rect.top;

        try {
            // Find the walkable surface under the cursor. The player's halo node
            // sits above their head, so every surface they could stand on — terrain,
            // a bridge deck, a building floor — is BELOW it, while roofs/overhangs
            // are above. Among the pickable meshes the ray crosses, take the highest
            // one at or below the halo height: that's the bridge deck when on a
            // bridge, the floor when in a building, the terrain otherwise, and it
            // ignores roofs overhead. (No epsilon here — a +fudge let a low roof
            // edge sneak under the cutoff and win over the floor.)
            const halo = this.getMainPlayer()?._appearance?._haloNode?.getAbsolutePosition?.();
            const headY = typeof halo?.y === "number" ? halo.y : Infinity;

            const points: any[] = (scene.multiPick?.(cx, cy, (mesh: any) => mesh?.isPickable) ?? [])
                .map((h: any) => h?.pickedPoint)
                .filter((p: any) => p && isFinite(p.y));
            if (!points.length) {
                this.warn("no walkable surface at pointer");
                return null;
            }

            const belowHead = points.filter((p: any) => p.y <= headY);
            // Prefer the highest surface at/under head height; if the click only
            // crossed things above the head (e.g. a roof you're not on), fall back
            // to the lowest hit so we never snap a marker onto a roof.
            const best = belowHead.length
                ? belowHead.reduce((a, b) => (b.y > a.y ? b : a))
                : points.reduce((a, b) => (b.y < a.y ? b : a));

            return {
                x: Math.floor(best.x),
                z: Math.floor(best.z),
                y: best.y,
                level: this.getPlayerLevel(),
            };
        } catch (err) {
            this.warn("surface pick failed", err);
            return null;
        }
    }

    // ---- Marker store -------------------------------------------------------

    private findMarkerIndex(x: number, z: number, level: number): number {
        return this.markers.findIndex(
            m => m.x === x && m.z === z && (m.level ?? 0) === level
        );
    }

    private upsertMarker(marker: TileMarker, existingIdx: number): void {
        if (existingIdx >= 0) {
            this.markers[existingIdx] = marker;
        } else {
            this.markers.push(marker);
        }
        this.data.markers = this.markers;
        this.syncExportField();
    }

    private removeMarker(idx: number): void {
        this.markers.splice(idx, 1);
        this.data.markers = this.markers;
        this.syncExportField();
    }

    private clearAllMarkers(): void {
        if (!this.markers.length) return;
        if (!confirm(`Delete all ${this.markers.length} tile marker(s)?`)) return;
        this.markers.length = 0;
        this.data.markers = this.markers;
        this.syncExportField();
    }

    // ---- Create / edit panel ------------------------------------------------

    private openCreatePanel(
        screenX: number,
        screenY: number,
        x: number,
        z: number,
        y: number,
        level: number,
        existingIdx: number
    ): void {
        this.closeCreatePanel();

        const existing = existingIdx >= 0 ? this.markers[existingIdx] : null;
        const panel = document.createElement("div");
        panel.id = CREATE_PANEL_ID;

        const defaultColor = (this.settings.defaultColor?.value as string) || "#ffea00";
        const initialLabel = existing?.label ?? "";
        const initialColor = existing?.color ?? defaultColor;

        panel.innerHTML = `
            <div><strong>${existing ? "Edit marker" : "Mark tile"}</strong></div>
            <div class="tm-coords">tile (${x}, ${z})</div>
            <div class="tm-row">
                <label for="tm-label-input">Label</label>
                <input id="tm-label-input" type="text" maxlength="40" placeholder="(optional)" />
            </div>
            <div class="tm-row">
                <label for="tm-color-input">Color</label>
                <input id="tm-color-input" type="color" />
            </div>
            <div class="tm-buttons">
                ${existing ? '<button class="tm-danger" data-act="delete">Unmark</button>' : ""}
                <button data-act="cancel">Cancel</button>
                <button class="tm-primary" data-act="save">Save</button>
            </div>
        `;

        document.body.appendChild(panel);

        const labelInput = panel.querySelector<HTMLInputElement>("#tm-label-input")!;
        const colorInput = panel.querySelector<HTMLInputElement>("#tm-color-input")!;
        labelInput.value = initialLabel;
        colorInput.value = initialColor;

        const rect = panel.getBoundingClientRect();
        const left = Math.min(screenX, window.innerWidth - rect.width - 10);
        const top = Math.min(screenY, window.innerHeight - rect.height - 10);
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;

        const close = () => this.closeCreatePanel();
        const save = () => {
            const label = labelInput.value.trim();
            const color = colorInput.value || defaultColor;
            this.upsertMarker({ x, z, y, level, label, color }, existingIdx);
            close();
        };
        const remove = () => {
            if (existingIdx >= 0) this.removeMarker(existingIdx);
            close();
        };

        panel.addEventListener("click", ev => {
            const target = ev.target as HTMLElement;
            const act = target?.dataset?.act;
            if (act === "save") save();
            else if (act === "cancel") close();
            else if (act === "delete") remove();
        });

        // Shield typed keys from the game's key handlers (which bubble up to
        // document/window) WITHOUT preventing the input's default text entry.
        // stopPropagation at the target stops bubbling; default action stays.
        const shield = (ev: KeyboardEvent) => {
            ev.stopPropagation();
            if (ev.type === "keydown") {
                if (ev.key === "Enter") { ev.preventDefault(); save(); }
                else if (ev.key === "Escape") { ev.preventDefault(); close(); }
            }
        };
        labelInput.addEventListener("keydown", shield);
        labelInput.addEventListener("keyup", shield);
        labelInput.addEventListener("keypress", shield);

        // The panel opens from a click on the game's context-menu item; the game
        // closes that menu and refocuses its canvas afterward, which steals focus
        // from our input. Re-assert focus across a few timings so a later attempt
        // wins after the game has finished refocusing. A focusout guard pulls
        // focus back if it leaves the panel while the panel is still open.
        const focusInput = () => {
            if (this.createPanelEl !== panel) return;
            labelInput.focus();
            labelInput.select();
        };
        requestAnimationFrame(focusInput);
        setTimeout(focusInput, 0);
        setTimeout(focusInput, 60);
        setTimeout(focusInput, 150);

        labelInput.addEventListener("focusout", (ev: FocusEvent) => {
            const next = ev.relatedTarget as Node | null;
            if (next && panel.contains(next)) return; // moving within the panel is fine
            setTimeout(() => {
                if (this.createPanelEl === panel) labelInput.focus();
            }, 0);
        });

        this.createPanelEl = panel;
    }

    private closeCreatePanel(): void {
        if (this.createPanelEl?.parentNode) {
            this.createPanelEl.parentNode.removeChild(this.createPanelEl);
        }
        this.createPanelEl = null;
    }

    // ---- Import / Export ----------------------------------------------------

    /** JSON of all markers — a readable, shareable string. */
    private serializeMarkers(): string {
        try {
            return JSON.stringify(this.markers);
        } catch (err) {
            this.warn("serializeMarkers failed", err);
            return "";
        }
    }

    /** Accepts JSON (preferred) or a legacy base64 code. Returns null if invalid. */
    private deserializeMarkers(input: string): TileMarker[] | null {
        const str = input.trim();
        if (!str) return null;

        let parsed: any;
        try {
            parsed = JSON.parse(str);
        } catch {
            // Not JSON — try the old base64(JSON) format for backward compatibility.
            try {
                parsed = JSON.parse(decodeURIComponent(escape(atob(str))));
            } catch {
                return null;
            }
        }
        if (!Array.isArray(parsed)) return null;

        const out: TileMarker[] = [];
        for (const m of parsed) {
            if (
                m && typeof m.x === "number" && typeof m.z === "number" &&
                typeof m.y === "number" && isFinite(m.x) && isFinite(m.z) && isFinite(m.y)
            ) {
                out.push({
                    x: m.x,
                    z: m.z,
                    y: m.y,
                    level: typeof m.level === "number" ? m.level : 0,
                    label: typeof m.label === "string" ? m.label : "",
                    color: typeof m.color === "string" ? m.color : "#ffea00",
                });
            }
        }
        return out;
    }

    /** Keep the export field showing the current markers (for copy-out). */
    private syncExportField(): void {
        const code = this.serializeMarkers();
        if (this.settings.importExport) {
            this.settings.importExport.value = code;
        }
        // The framework only paints a setting's value when the panel (re)opens, so
        // also update the live textarea DOM if the panel is currently showing —
        // unless the user is actively editing it (don't clobber an in-progress paste).
        try {
            const row = document.getElementById("highlite-settings-content-row-importExport");
            const ta = row?.querySelector("textarea") as HTMLTextAreaElement | null;
            if (ta && document.activeElement !== ta) {
                ta.value = code;
            }
        } catch {
            /* DOM not present (panel closed) — value property sync above is enough */
        }
    }

    private onImportExportChanged(): void {
        const raw = (this.settings.importExport?.value as string) ?? "";
        // Empty field is a no-op: use the "Clear all markers" button to wipe.
        // Also ignore if it already matches what we'd export (our own sync write).
        if (!raw.trim() || raw.trim() === this.serializeMarkers()) return;

        const imported = this.deserializeMarkers(raw);
        if (!imported) {
            this.warn("Import failed: not a valid tile-markers code.");
            return;
        }
        this.markers.length = 0;
        this.markers.push(...imported);
        this.data.markers = this.markers;
        this.syncExportField();
        this.log(`Imported ${imported.length} tile marker(s).`);
    }

    // ---- Overlay & rendering ------------------------------------------------

    private injectStyles(): void {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
#${OVERLAY_ID} {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 50;
    overflow: hidden;
}
#${OVERLAY_ID} svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
}
#${OVERLAY_ID} .tm-label {
    position: absolute;
    transform: translate(-50%, -100%);
    padding: 2px 6px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-family: sans-serif;
    font-size: 12px;
    line-height: 1.2;
    white-space: nowrap;
    pointer-events: none;
    text-shadow: 0 1px 2px #000;
}
#${CREATE_PANEL_ID} {
    position: fixed;
    z-index: 10000;
    min-width: 220px;
    padding: 10px 12px;
    background: #1e1e1e;
    border: 1px solid #555;
    border-radius: 4px;
    color: #e0e0e0;
    font-family: sans-serif;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.6);
}
#${CREATE_PANEL_ID} .tm-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
#${CREATE_PANEL_ID} label { color: #aaa; font-size: 12px; }
#${CREATE_PANEL_ID} input[type="text"] {
    flex: 1; min-width: 0;
    padding: 4px 6px;
    background: #2a2a2a; color: #fff;
    border: 1px solid #555; border-radius: 3px;
    font-size: 13px;
}
#${CREATE_PANEL_ID} input[type="color"] {
    width: 32px; height: 24px;
    padding: 0; border: 1px solid #555; border-radius: 3px;
    background: transparent;
}
#${CREATE_PANEL_ID} .tm-buttons { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
#${CREATE_PANEL_ID} button {
    padding: 4px 12px;
    background: #2a2a2a; color: #fff;
    border: 1px solid #666; border-radius: 3px;
    cursor: pointer; font-size: 12px;
}
#${CREATE_PANEL_ID} button:hover { background: #3a3a3a; }
#${CREATE_PANEL_ID} button.tm-primary { background: #2d5fa3; border-color: #2d5fa3; }
#${CREATE_PANEL_ID} button.tm-primary:hover { background: #3a73c2; }
#${CREATE_PANEL_ID} button.tm-danger { background: #7a2b2b; border-color: #7a2b2b; }
#${CREATE_PANEL_ID} button.tm-danger:hover { background: #9a3434; }
#${CREATE_PANEL_ID} .tm-coords { font-size: 11px; color: #888; }
`;
        document.head.appendChild(style);
    }

    private buildOverlay(): void {
        const canvas = this.getRenderingCanvas();
        const host = canvas?.parentElement ?? document.body;
        const overlay = document.createElement("div");
        overlay.id = OVERLAY_ID;

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        overlay.appendChild(svg);

        const labels = document.createElement("div");
        labels.style.position = "absolute";
        labels.style.inset = "0";
        labels.style.pointerEvents = "none";
        overlay.appendChild(labels);

        if (getComputedStyle(host).position === "static") {
            host.style.position = "relative";
        }
        host.appendChild(overlay);

        this.overlayEl = overlay;
        this.svgEl = svg as SVGSVGElement;
        this.labelLayerEl = labels;
    }

    private hookRenderLoop(): void {
        const scene = this.getScene();
        if (!scene?.onBeforeRenderObservable?.add) {
            this.warn("Scene not available at start; render loop not hooked.");
            return;
        }
        this.observedScene = scene;
        this.renderObserver = scene.onBeforeRenderObservable.add(() => this.renderFrame());
    }

    private refreshLabelVisibility(): void {
        if (!this.labelLayerEl) return;
        const show = this.settings.showLabels?.value !== false;
        this.labelLayerEl.style.display = show ? "" : "none";
    }

    private renderFrame(): void {
        const scene = this.getScene();
        const engine = this.getEngine();
        const camera = this.getCamera();
        if (!scene || !engine || !camera || !this.svgEl || !this.labelLayerEl) return;

        const rw = engine.getRenderWidth(1);
        const rh = engine.getRenderHeight(1);
        const viewport = camera.viewport.toGlobal(rw, rh);
        const transform = scene.getTransformMatrix();
        const identity = Matrix.Identity();

        const currentLevel = this.getPlayerLevel();
        const showLabels = this.settings.showLabels?.value !== false;

        const polys: string[] = [];
        const labelEntries: { left: number; top: number; text: string; color: string }[] = [];

        for (const m of this.markers) {
            if (!isFinite(m.x) || !isFinite(m.y) || !isFinite(m.z)) continue;
            if ((m.level ?? 0) !== currentLevel) continue;

            const corners = [
                new Vector3(m.x, m.y, m.z),
                new Vector3(m.x + 1, m.y, m.z),
                new Vector3(m.x + 1, m.y, m.z + 1),
                new Vector3(m.x, m.y, m.z + 1),
            ];
            const projected = corners.map(c =>
                Vector3.Project(c, identity, transform, viewport)
            );
            if (projected.some(p => !isFinite(p.x) || !isFinite(p.y))) continue;
            const allBehind = projected.every(p => p.z < 0 || p.z > 1);
            if (allBehind) continue;

            const points = projected.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
            polys.push(
                `<polygon points="${points}" fill="none" stroke="${escapeHtml(m.color)}" stroke-width="2" />`
            );

            if (showLabels && m.label) {
                const cx = (projected[0].x + projected[2].x) / 2;
                const cy = Math.min(projected[0].y, projected[1].y, projected[2].y, projected[3].y);
                labelEntries.push({ left: cx, top: cy, text: m.label, color: m.color });
            }
        }

        const w = this.overlayEl?.clientWidth ?? rw;
        const h = this.overlayEl?.clientHeight ?? rh;
        const scaleX = w / rw;
        const scaleY = h / rh;

        this.svgEl.setAttribute("viewBox", `0 0 ${rw} ${rh}`);
        this.svgEl.setAttribute("preserveAspectRatio", "none");
        this.svgEl.innerHTML = polys.join("");

        let labelHtml = "";
        for (const l of labelEntries) {
            labelHtml += `<div class="tm-label" style="left:${(l.left * scaleX).toFixed(1)}px;top:${(l.top * scaleY).toFixed(1)}px;border:1px solid ${escapeHtml(l.color)}">${escapeHtml(l.text)}</div>`;
        }
        this.labelLayerEl.innerHTML = labelHtml;
    }
}

/** Escape a string for safe insertion into HTML text or an attribute value. */
function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c =>
        c === "&" ? "&amp;" :
        c === "<" ? "&lt;" :
        c === ">" ? "&gt;" :
        c === '"' ? "&quot;" : "&#39;"
    );
}
