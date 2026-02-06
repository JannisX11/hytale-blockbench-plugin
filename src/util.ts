//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { CubeHytale } from "./blockymodel";


export function qualifiesAsMainShape(object: OutlinerNode): boolean {
	return object instanceof Cube && object.rotation.allEqual(0);
}
export function cubeIsQuad(cube: CubeHytale): boolean {
	if (!cube.size().some(val => val == 0)) return false;
	let faces = Object.keys(cube.faces).filter(fkey => cube.faces[fkey].texture !== null);
	if (faces.length > 1) return false;
	return true;
}
export function getMainShape(group: Group): CubeHytale | undefined {
    return group.children.find(qualifiesAsMainShape) as CubeHytale | undefined;
}