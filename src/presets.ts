// Built-in marker sets that can be toggled on/off from the plugin settings.
// These are drawn alongside the user's own markers but are never stored in,
// or exported through, the Import/Export field.

export interface PresetTile {
    x: number;
    z: number;
    y: number;
    level: number;
}

export interface MarkerPreset {
    /** Settings key of the checkbox that toggles this set. */
    settingKey: string;
    /** Text shown next to the checkbox. */
    settingText: string;
    /** Label drawn above every tile in the set. */
    label: string;
    /** Border color of every tile in the set. */
    color: string;
    tiles: PresetTile[];
}

const T3_MAPS: PresetTile[] = [
    { x: -401, z: -293, y: 4.251494790814172, level: 1 },
    { x: -392, z: -447, y: 5.300072117350979, level: 1 },
    { x: -351, z: -479, y: 8.438763033922413, level: 1 },
    { x: -273, z: -497, y: 5.568608785726489, level: 1 },
    { x: -218, z: -185, y: 8.195195021404134, level: 1 },
    { x: -132, z: -342, y: 8.385670148591501, level: 1 },
    { x: -50, z: -432, y: 3.697393900601474, level: 1 },
    { x: -186, z: -37, y: 9.689888028119869, level: 1 },
    { x: 73, z: -359, y: 5.8530098529746235, level: 1 },
    { x: -217, z: -319, y: 18.129603718605765, level: 1 },
    { x: 95, z: -348, y: 33.057102209960675, level: 1 },
    { x: 179, z: -340, y: 6.2889770408953805, level: 1 },
    { x: 213, z: -304, y: 5.095838192496517, level: 1 },
    { x: 227, z: -323, y: 20.343196524333557, level: 1 },
    { x: 181, z: -420, y: 14.599806289050932, level: 1 },
    { x: 169, z: -452, y: 14.35721248181153, level: 1 },
    { x: 169, z: -495, y: 6.384946096052557, level: 1 },
    { x: 343, z: -467, y: 6.282940755568669, level: 1 },
    { x: 390, z: -486, y: 11.824139800494795, level: 1 },
    { x: 455, z: -510, y: 6.249796474801531, level: 1 },
    { x: 499, z: -502, y: 5.038337070545244, level: 1 },
    { x: 509, z: -462, y: 8.987309376105618, level: 1 },
    { x: 455, z: -385, y: 10.653025509680283, level: 1 },
    { x: 368, z: -388, y: 18.632109723290778, level: 1 },
    { x: 336, z: -402, y: 20.290910970959224, level: 1 },
    { x: 285, z: -417, y: 19.63556429892519, level: 1 },
    { x: 273, z: -364, y: 20.030446566705713, level: 1 },
    { x: 307, z: -381, y: 20.377928980422244, level: 1 },
    { x: 268, z: -395, y: 20.340821507677582, level: 1 },
    { x: 274, z: -321, y: 19.86426275823143, level: 1 },
    { x: 376, z: -338, y: 27.524556674010253, level: 1 },
    { x: 404, z: -330, y: 34.97621681462363, level: 1 },
    { x: 502, z: -266, y: 27.388962297180857, level: 1 },
    { x: 456, z: -83, y: 8.141472126284611, level: 1 },
    { x: 337, z: 26, y: 12.047058823529412, level: 1 },
    { x: 394, z: 59, y: 12.026405117508746, level: 1 },
    { x: 415, z: 28, y: 12.750634699440033, level: 1 },
    { x: 290, z: 35, y: 11.287234424776186, level: 1 },
    { x: 473, z: 111, y: 14.312570189501695, level: 1 },
    { x: 317, z: 98, y: 11.242166217891327, level: 1 },
    { x: 323, z: 212, y: 8.480883666731657, level: 1 },
    { x: 331, z: 234, y: 8.330692017008374, level: 1 },
    { x: 62, z: 442, y: 25.549345763339144, level: 1 },
    { x: 57, z: 417, y: 18.327043503149106, level: 1 },
    { x: 55, z: 382, y: 12.132355227318865, level: 1 },
    { x: 161, z: 395, y: 28.97489119429722, level: 0 },
    { x: -285, z: -478, y: 29.696916754076476, level: 0 },
    { x: -185, z: -346, y: 29.41678272557588, level: 0 },
];

// To add T1 / T2: define a tile list like T3_MAPS above and add an entry here.
export const MARKER_PRESETS: MarkerPreset[] = [
    {
        settingKey: "showT3Maps",
        settingText: "T3 Maps",
        label: "T3 Map",
        color: "#ff0000",
        tiles: T3_MAPS,
    },
];
