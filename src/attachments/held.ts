//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { CustomMenuItem } from "blockbench-types/generated/interface/menu";
import { track } from "../cleanup";
import { FORMAT_IDS } from "../formats";
import { BlockymodelNode } from "../blockymodel";
import { isGamePiece, isPieceNode } from "../util";
import { getOwningAttachment } from "./attach_to";
import { reparseAttachment } from "./rebuild";
import { pushReloadUndo } from "./watcher";
import { applyCollectionColors } from "./collection_color";

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

/** Switches between held and worn as one undo step */
function changeHeld(collection: Collection, held: boolean) {
	let uuid = collection.uuid;
	let apply = (value: boolean) => {
		// Undo entries can outlive this Collection object, so look it up again
		let target = Collection.all.find(c => c.uuid === uuid);
		if (!target || isHeld(target) === value) return;
		reparseAttachment(target, () => setHeld(target, value));
		applyCollectionColors();
	};
	apply(held);
	pushReloadUndo(!held, held, held ? 'Make attachment held' : 'Make attachment worn', apply);
}

export function setupHeld() {
	let held_property = new Property(Collection, 'boolean', 'held', {
		default: false,
		condition: {formats: FORMAT_IDS},
	});
	track(held_property);

	let isAttachment = () => Collection.selected.length == 1 && Collection.selected[0].export_codec === 'blockymodel';
	let make_held: CustomMenuItem = {
		id: 'hytale_make_held',
		name: 'Make Held Item',
		icon: 'pan_tool',
		condition: () => isAttachment() && !isHeld(Collection.selected[0]),
		click: () => changeHeld(Collection.selected[0], true),
	};
	let make_worn: CustomMenuItem = {
		id: 'hytale_make_worn',
		name: 'Make Worn Item',
		icon: 'checkroom',
		condition: () => isAttachment() && isHeld(Collection.selected[0]),
		click: () => changeHeld(Collection.selected[0], false),
	};
	Collection.menu.addAction(make_held, '#settings');
	Collection.menu.addAction(make_worn, '#settings');
	track({
		delete() {
			Collection.menu.removeAction('hytale_make_held');
			Collection.menu.removeAction('hytale_make_worn');
		}
	});
}
