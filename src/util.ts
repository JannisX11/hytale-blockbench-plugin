//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { CubeHytale } from "./blockymodel";


export function qualifiesAsMainShape(object: OutlinerNode): boolean {
	return object instanceof Cube && (object.rotation.allEqual(0) || cubeIsQuad(object as CubeHytale));
}
export function cubeIsQuad(cube: CubeHytale): boolean {
	return cube.size()[2] == 0;
}
export function getMainShape(group: Group): CubeHytale | undefined {
    return group.children.find(qualifiesAsMainShape) as CubeHytale | undefined;
}