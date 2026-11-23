//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS } from "../formats";
import { BlockymodelNode } from "../blockymodel";
import { isGamePiece, isPieceNode } from "../util";
import { getOwningAttachment } from "./attach_to";

type HeldCollection = Collection & { held: boolean };

/** Held attachments sit in a hand like in-game items, instead of merging into the skeleton */
export function isHeld(collection: Collection): boolean {
	return (collection as HeldCollection).held === true;
}
export function setHeld(collection: Collection, held: boolean) {
	(collection as HeldCollection).held = held;
}

/** Items and blocks are held, armor, cosmetics and NPC attachments are worn */
function isHeldModel(path: string, root?: {name: string, piece: boolean}): boolean {
	if (/[\\/](Armors|Cosmetics|Characters|Attachments)[\\/]/i.test(path)) return false;
	if (!root) return false;
	return !root.piece || /^[RL]-Attachment$/.test(root.name);
}
export function detectHeld(json: { nodes?: BlockymodelNode[] }, path: string): boolean {
	let root = json.nodes?.[0];
	return isHeldModel(path, root && {name: root.name, piece: isPieceNode(root)});
}
/** Whether the open model, outside its attachments, would load as a held item */
export function detectProjectHeld(): boolean {
	let root = Outliner.root.find(node => (node instanceof Group || node instanceof Cube) && !getOwningAttachment(node));
	return isHeldModel(Project.export_path ?? '', root && {name: root.name, piece: root instanceof Group && isGamePiece(root)});
}

export function setupHeld() {
	// Detected from the file on every parse; kept on the collection for undo and the list icon
	let held_property = new Property(Collection, 'boolean', 'held', {
		default: false,
		condition: {formats: FORMAT_IDS},
	});
	track(held_property);
}
