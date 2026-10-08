//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { isHytaleFormat } from "../formats";

/** Finds the blockymodel collection containing a group, if any. */
function findAttachmentCollection(group: Group): Collection | undefined {
	return Collection.all.find(c => c.export_codec === 'blockymodel' && c.contains(group));
}

/** Finds the is_piece wrapper ancestor of a group, or undefined if the group itself is a collection root. */
function findPieceWrapper(group: Group, collection: Collection): Group | undefined {
	let current: OutlinerNode = group;
	while (current instanceof Group) {
		if ((current as any).is_piece && collection.children.includes(current.uuid)) {
			return current;
		}
		current = current.parent;
	}
	return undefined;
}

export function setupDetachFromAttachment() {
	let detach_action = new Action('detach_from_hytale_attachment', {
		name: 'Detach from Attachment',
		icon: 'move_up',
		category: 'edit',
		condition: () => {
			if (!Modes.edit || !isHytaleFormat()) return false;
			let group = Group.first_selected;
			if (!group) return false;
			return !!findAttachmentCollection(group);
		},
		click() {
			let selectedGroups = Group.all.filter(g => g.selected);
			// Only process groups inside an attachment
			selectedGroups = selectedGroups.filter(g => findAttachmentCollection(g));
			if (selectedGroups.length === 0) return;

			// Deduplicate: if parent and child are both selected, keep only the parent
			selectedGroups = selectedGroups.filter(group => {
				let parent = group.parent;
				while (parent instanceof Group) {
					if (selectedGroups.includes(parent)) return false;
					parent = parent.parent;
				}
				return true;
			});

			// Collect all affected objects for undo
			let allElements: OutlinerElement[] = [];
			let allGroups: Group[] = [];
			let affectedCollections: Collection[] = [];

			for (let group of selectedGroups) {
				let collection = findAttachmentCollection(group)!;
				affectedCollections.safePush(collection);
				allGroups.safePush(group);
				group.forEachChild((obj: OutlinerNode) => {
					if (obj instanceof Group) allGroups.safePush(obj);
					else allElements.safePush(obj as OutlinerElement);
				}, Group, true);

				let wrapper = findPieceWrapper(group, collection);
				if (wrapper) allGroups.safePush(wrapper);
			}

			Undo.initEdit({
				collections: affectedCollections,
				groups: allGroups,
				elements: allElements,
				outliner: true,
			});

			for (let group of selectedGroups) {
				let collection = findAttachmentCollection(group)!;
				let wrapper = findPieceWrapper(group, collection);

				if (wrapper && wrapper !== group) {
					// Group is inside a is_piece wrapper — move to wrapper's parent
					let wrapperParent = wrapper.parent;
					let insertIndex = wrapper.getParentArray().indexOf(wrapper);
					group.addTo(wrapperParent, insertIndex);

					// If wrapper is now empty, remove it and its collection reference
					if (wrapper.children.length === 0) {
						collection.children.remove(wrapper.uuid);
						wrapper.remove(false);
					}
				} else if (wrapper === group) {
					// The selected group IS the is_piece wrapper — resolve it
					collection.children.remove(group.uuid);
					// Reparent children to wrapper's parent, using resolve's transform logic
					let children = group.children.slice();
					let parent = group.parent;
					let insertIndex = group.getParentArray().indexOf(group);
					for (let child of children) {
						child.addTo(parent, insertIndex);
					}
					group.remove(false);
				} else {
					// Root-level collection member (no wrapper) — just remove from collection
					collection.children.remove(group.uuid);
					// Strip attachment name prefix from group name
					let prefix = collection.name + ':';
					if (group.name.startsWith(prefix)) {
						group.name = group.name.substring(prefix.length);
					}
					group.color = 0;
				}

				// If collection has no children left, remove it
				if (collection.children.length === 0) {
					Collection.all.remove(collection);
				}
			}

			Canvas.updateAllPositions();
			Undo.finishEdit('Detach from attachment');
			updateSelection();
		}
	});
	track(detach_action);

	// Add to group context menu before 'manage' separator
	Group.prototype.menu.addAction(detach_action, '#manage');
	track({
		delete() {
			Group.prototype.menu.removeAction(detach_action);
		}
	});
}
