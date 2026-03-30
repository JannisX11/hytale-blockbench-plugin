//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { isHytaleFormat } from "../formats";
import { getMainShape } from "../util";

/** Returns selected attachment collections (blockymodel export codec). */
function getSelectedAttachmentCollections(): Collection[] {
	return Collection.selected.filter(c => c.export_codec === 'blockymodel');
}

/**
 * Returns selected groups valid for adding to an attachment:
 * not already in a blockymodel collection, deduplicated so only parents are kept.
 */
function getSelectedRootGroups(): Group[] {
	let selected = Group.all.filter(g => g.selected);

	selected = selected.filter(g => !Collection.all.some(c => c.export_codec === 'blockymodel' && c.contains(g)));

	return selected.filter(group => {
		let parent = group.parent;
		while (parent instanceof Group) {
			if (selected.includes(parent)) return false;
			parent = parent.parent;
		}
		return true;
	});
}

/**
 * Creates is_piece wrapper groups and adds them to the given collection.
 * Same logic as create.ts's createIsPieceWrappers but for an existing attachment.
 */
function addGroupsToAttachment(attachmentName: string, selectedGroups: Group[], collection: Collection) {
	let wrappersByParent = new Map<Group, Group>();
	let newRoots: Group[] = [];

	for (let group of selectedGroups) {
		let parent = group.parent;

		if (parent instanceof Group) {
			let wrapper = wrappersByParent.get(parent);
			if (!wrapper) {
				let referenceNode = getMainShape(parent) ?? parent;

				wrapper = new Group({
					name: attachmentName + ':' + parent.name,
					autouv: 1,
					origin: referenceNode.origin.slice(),
					rotation: [0, 0, 0],
					visibility: true,
				});
				wrapper.addTo(parent);
				wrapper.init();
				wrapper.extend({
					is_piece: true,
					original_position: [0, 0, 0],
					original_offset: [0, 0, 0],
				} as any);
				wrapper.color = 1;

				wrappersByParent.set(parent, wrapper);
				newRoots.push(wrapper);
			}

			group.addTo(wrapper);
		} else {
			// Root-level group: prefix name and add directly
			group.name = attachmentName + ':' + group.name;
			group.color = 1;
			newRoots.push(group);
		}
	}

	// Add new roots to the collection
	for (let root of newRoots) {
		collection.children.push(root.uuid);
	}

	return newRoots;
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
				let newRoots = addGroupsToAttachment(collection.name, selectedGroups, collection);
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
