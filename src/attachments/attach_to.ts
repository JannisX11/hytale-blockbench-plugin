//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { CustomMenuItem } from "blockbench-types/generated/interface/menu";
import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";
import { isUnloaded } from "./unload";
import { pushReloadUndo } from "./watcher";
import { reparseAttachment } from "./rebuild";

type ParentedCollection = Collection & { attach_to: string };
type ParentChange = [Collection, Collection | undefined];
// Undo entries outlive Collection objects (delete + undo recreates them), so they reference uuids
type ParentChangeRecord = [string, string];

function getAttachments(): Collection[] {
	return Collection.all.filter(c => c.export_codec === 'blockymodel');
}
/** The attachment a node belongs to: the nearest attachment root at or above it */
export function getOwningAttachment(node: OutlinerNode): Collection | undefined {
	let attachments = getAttachments();
	let current: OutlinerNode | 'root' = node;
	while (current instanceof OutlinerNode) {
		let uuid = current.uuid;
		let owner = attachments.find(c => c.children.includes(uuid));
		if (owner) return owner;
		current = current.parent;
	}
	// Root-level shapes aren't listed as collection children
	if (node.parent !== 'root' || !node.scope) return;
	return attachments.find(c => c.scope == node.scope);
}

export function getAttachParent(collection: Collection): Collection | undefined {
	let uuid = (collection as ParentedCollection).attach_to;
	return uuid ? Collection.all.find(c => c.uuid === uuid) : undefined;
}

/** Attachments a collection can bind to, outermost first, ending with its direct parent */
export function getAttachChain(collection: Collection | undefined): Collection[] {
	let chain: Collection[] = [];
	let parent = collection && getAttachParent(collection);
	while (parent && parent !== collection && !chain.includes(parent)) {
		chain.unshift(parent);
		parent = getAttachParent(parent);
	}
	return chain;
}

/** Attachments bound to this one, directly or indirectly, parents before children */
export function getAttachDependents(collection: Collection): Collection[] {
	let dependents: Collection[] = [];
	let queue = [collection];
	while (queue.length) {
		let current = queue.shift()!;
		for (let child of Collection.all) {
			if (child === collection || dependents.includes(child) || getAttachParent(child) !== current) continue;
			dependents.push(child);
			queue.push(child);
		}
	}
	return dependents;
}

function applyAttachParents(records: ParentChangeRecord[]) {
	for (let [uuid, parent_uuid] of records) {
		let collection = Collection.all.find(c => c.uuid === uuid);
		if (!collection || (collection as ParentedCollection).attach_to === parent_uuid) continue;
		reparseAttachment(collection, () => { (collection as ParentedCollection).attach_to = parent_uuid; });
	}
}

/** Changes attachment parents as one undo step */
export function setAttachParents(changes: ParentChange[], message = 'Change attachment parent') {
	changes = changes.filter(([collection, parent]) => getAttachParent(collection) !== parent);
	if (!changes.length) return;
	let before: ParentChangeRecord[] = changes.map(([collection]) => [collection.uuid, (collection as ParentedCollection).attach_to ?? '']);
	let after: ParentChangeRecord[] = changes.map(([collection, parent]) => [collection.uuid, parent?.uuid ?? '']);
	applyAttachParents(after);
	pushReloadUndo(before, after, message, applyAttachParents);
}

/** Before removing attachments, re-binds those attached to them to the nearest remaining parent */
export function releaseDependents(removed: Collection[]) {
	let changes: ParentChange[] = [];
	for (let collection of Collection.all) {
		if (removed.includes(collection)) continue;
		let parent = getAttachParent(collection);
		if (!parent || !removed.includes(parent)) continue;
		while (parent && removed.includes(parent)) parent = getAttachParent(parent);
		changes.push([collection, parent]);
	}
	setAttachParents(changes, 'Release attached attachments');
}

export function setupAttachTo() {
	let attach_to_property = new Property(Collection, 'string', 'attach_to', {
		default: '',
		condition: {formats: FORMAT_IDS},
	});
	track(attach_to_property);

	// Attachments nest inside each other's groups, so membership stops at the nearest attachment root
	let original_contains = Collection.prototype.contains;
	let original_get_children = Collection.prototype.getChildren;
	let original_get_all_children = Collection.prototype.getAllChildren;
	let isAttachment = (collection: Collection) => isHytaleFormat() && collection.export_codec === 'blockymodel';
	Collection.prototype.contains = function(this: Collection, node: OutlinerNode) {
		if (!isAttachment(this)) return original_contains.call(this, node);
		return getOwningAttachment(node) === this;
	};
	Collection.prototype.getChildren = function(this: Collection) {
		if (!isAttachment(this)) return original_get_children.call(this);
		return this.children.map(uuid => OutlinerNode.uuids[uuid]).filter(Boolean);
	};
	Collection.prototype.getAllChildren = function(this: Collection) {
		if (!isAttachment(this)) return original_get_all_children.call(this);
		return Outliner.nodes.filter(node => getOwningAttachment(node) === this);
	};
	track({
		delete() {
			Collection.prototype.contains = original_contains;
			Collection.prototype.getChildren = original_get_children;
			Collection.prototype.getAllChildren = original_get_all_children;
		}
	});

	let attach_to_menu: CustomMenuItem = {
		id: 'hytale_attach_to',
		name: 'Attach To',
		icon: 'link',
		condition: () => Collection.selected.length == 1 && Collection.selected[0].export_codec === 'blockymodel' && !isUnloaded(Collection.selected[0]),
		children() {
			let collection = Collection.selected[0];
			let current = getAttachParent(collection);
			let excluded = [collection, ...getAttachDependents(collection)];
			let entry = (name: string, target: Collection | undefined): CustomMenuItem => ({
				name,
				icon: current === target ? 'radio_button_checked' : 'radio_button_unchecked',
				click: () => setAttachParents([[collection, target]]),
			});
			let items: CustomMenuItem[] = [entry('Main Model', undefined)];
			for (let candidate of getAttachments()) {
				if (excluded.includes(candidate)) continue;
				items.push(entry(candidate.name, candidate));
			}
			return items;
		}
	};
	Collection.menu.addAction(attach_to_menu, '#settings');
	track({
		delete() {
			Collection.menu.removeAction('hytale_attach_to');
		}
	});
}
