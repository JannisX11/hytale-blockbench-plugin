//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { isHytaleFormat } from "../formats";
import { createIsPieceWrappers, getSelectedRootGroups } from "./create";

/** Returns selected attachment collections (blockymodel export codec). */
function getSelectedAttachmentCollections(): Collection[] {
	return Collection.selected.filter(c => c.export_codec === 'blockymodel');
}

export function setupAddToAttachment() {
	let add_to_attachment = new Action('add_to_hytale_attachment', {
		name: 'Add Selection to Attachment',
		icon: 'box_add',
		category: 'file',
		condition: () => Modes.edit && isHytaleFormat() && getSelectedRootGroups().length > 0 && getSelectedAttachmentCollections().length > 0,
		click() {
			let collections = getSelectedAttachmentCollections();
			let selectedGroups = getSelectedRootGroups();
			if (selectedGroups.length === 0) return;

			Undo.initEdit({
				collections,
				groups: selectedGroups,
				outliner: true,
			});

			let allNewWrappers: Group[] = [];
			for (let collection of collections) {
				let newRoots = createIsPieceWrappers(collection.name, selectedGroups, collection);
				collection.children.push(...newRoots.map(root => root.uuid));
				let newWrapperGroups = newRoots.filter(g => !selectedGroups.includes(g));
				allNewWrappers.push(...newWrapperGroups);
			}

			Undo.finishEdit('Add to attachment', {
				collections,
				groups: [...selectedGroups, ...allNewWrappers],
				outliner: true,
			});

			Canvas.updateAllFaces();
		}
	});
	track(add_to_attachment);
	Panels.collections.toolbars[0].add(add_to_attachment);
}
