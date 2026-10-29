//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { isHytaleFormat } from "../formats";
import { pushReloadUndo, unwatchCollection } from "./watcher";
import { releaseDependents } from "./attach_to";

/** Replaces the latest undo entries with a single step */
function joinUndoSteps(entries: UndoEntry[], message: string) {
	if (entries.length < 2) return;
	Undo.history.splice(Undo.history.length - entries.length, entries.length);
	Undo.index = Undo.history.length;
	pushReloadUndo('undo', 'redo', message, (direction: string) => {
		if (direction == 'undo') {
			entries.slice().reverse().forEach(entry => Undo.loadSave(entry.before!, entry.post!));
		} else {
			entries.forEach(entry => Undo.loadSave(entry.post!, entry.before!));
		}
	});
}

/** Removes attachments with their nodes and textures, as one undo step together with releasing their dependents */
export function removeAttachments(collections: Collection[], message: string) {
	let previous_entries = new Set(Undo.history);
	releaseDependents(collections);
	let remove_elements: OutlinerElement[] = [];
	let remove_groups: Group[] = [];
	let textures: Texture[] = [];
	let texture_groups: TextureGroup[] = [];

	for (let collection of collections) {
		if (collection.export_codec !== 'blockymodel') continue;
		for (let child of collection.getAllChildren()) {
			(child instanceof Group ? remove_groups : remove_elements).safePush(child as OutlinerElement);
		}
		let texture_group = TextureGroup.all.find(tg => tg.name === collection.name);
		if (texture_group) {
			textures.safePush(...Texture.all.filter(t => t.group === texture_group.uuid));
			texture_groups.push(texture_group);
		}
	}

	Undo.initEdit({
		collections,
		groups: remove_groups,
		elements: remove_elements,
		outliner: true,
		texture_groups,
		textures,
	});

	collections.forEach(c => {
		unwatchCollection(c);
		Collection.all.remove(c);
	});
	// Removed objects must be missing from the "after" save so undo recreates them
	collections.empty();
	textures.forEach(t => t.remove(true));
	textures.empty();
	texture_groups.forEach(t => t.remove());
	texture_groups.empty();
	remove_groups.forEach(group => group.remove());
	remove_groups.empty();
	remove_elements.forEach(element => element.remove());
	remove_elements.empty();

	updateSelection();
	Undo.finishEdit(message);
	joinUndoSteps(Undo.history.filter(entry => !previous_entries.has(entry)), message);
}

export function setupDelete() {
	let shared_delete = SharedActions.add('delete', {
		subject: 'collection',
		priority: 1,
		condition: () => Prop.active_panel == 'collections' && isHytaleFormat() && Collection.selected.some(c => c.export_codec === 'blockymodel'),
		run() {
			removeAttachments(Collection.selected.slice(), 'Remove attachment');
		}
	});
	track(shared_delete);
}
