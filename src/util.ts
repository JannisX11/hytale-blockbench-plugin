//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { BlockymodelNode, CubeHytale } from "./blockymodel";


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
/** In-game, only shapeless nodes act as pieces */
export function isGamePiece(group: Group): boolean {
	return (group as Group & {is_piece?: boolean}).is_piece === true && !getMainShape(group);
}
export function isPieceNode(node: BlockymodelNode): boolean {
	return node.shape?.type == 'none' && node.shape?.settings?.isPiece === true;
}
/** Origin of the frame a bone's children sit in: main shape center, or pivot plus offset */
export function getBoneAnchor(bone: Group): ArrayVector3 {
	let shape = getMainShape(bone);
	if (shape) return shape.from.slice().V3_add(shape.to).V3_divide(2, 2, 2) as ArrayVector3;
	return bone.origin.slice().V3_add(bone.original_offset ?? [0, 0, 0]) as ArrayVector3;
}