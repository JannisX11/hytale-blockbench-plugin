//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { BlockymodelNode } from "../blockymodel";
import { assignCollectionScope, isUnloaded } from "./unload";
import { getAttachDependents } from "./attach_to";
import { isHeld } from "./held";

export type AnimatorStash = [BBAnimation, string, GeneralAnimator][];

/** Parses attachment JSON into an existing collection */
export function parseAttachmentJson(collection: Collection, json: any, path: string) {
	let result: any = Codecs.blockymodel.parse(json, path, {attachment: collection.name, held: isHeld(collection)});
	let new_groups = result.new_groups as Group[];
	let root_groups = new_groups.filter(group => !new_groups.includes(group.parent as Group));
	collection.extend({ children: root_groups.map(g => g.uuid) }).add();
	assignCollectionScope(collection);
}

/** Carries uuids from a snapshot over to freshly read file data, matching nodes by name path, then by unique name */
export function transferNodeUuids(from: { nodes: BlockymodelNode[] }, to: { nodes: BlockymodelNode[] }) {
	let by_path = new Map<string, BlockymodelNode[]>();
	let by_name = new Map<string, BlockymodelNode[]>();
	// Static box suffixes get renumbered on save
	let baseName = (node: BlockymodelNode) => node.name.replace(/--C\d+$/, '');
	let collect = (nodes: BlockymodelNode[] | undefined, path: string) => {
		for (let node of nodes ?? []) {
			let key = path + '/' + baseName(node);
			by_path.set(key, [...(by_path.get(key) ?? []), node]);
			by_name.set(baseName(node), [...(by_name.get(baseName(node)) ?? []), node]);
			collect(node.children, key);
		}
	};
	collect(from.nodes, '');
	let used = new Set<BlockymodelNode>();
	let sameKind = (a: BlockymodelNode, b: BlockymodelNode) => !!a.shape?.settings?.isStaticBox == !!b.shape?.settings?.isStaticBox;
	let copy = (source: BlockymodelNode, node: BlockymodelNode) => {
		used.add(source);
		node.uuid = source.uuid;
		node.shapeUuid = source.shapeUuid;
		// Keep the eye state the user set where it differs from the file, while the file keeps its own state
		if (!node.shape) return;
		node.fileHidden = node.shape.visible == false;
		// Groups are never hidden by the file (only their shape is), so their eye state carries over as is
		node.groupVisible = source.groupVisible ?? true;
		let shape_visible = source.shape?.visible != false;
		if (shape_visible == !!source.fileHidden) node.shape.visible = shape_visible;
	};
	let unmatched: BlockymodelNode[] = [];
	let assign = (nodes: BlockymodelNode[] | undefined, path: string) => {
		for (let node of nodes ?? []) {
			let key = path + '/' + baseName(node);
			let source = by_path.get(key)?.find(c => !used.has(c) && sameKind(c, node));
			if (source) copy(source, node);
			else unmatched.push(node);
			assign(node.children, key);
		}
	};
	assign(to.nodes, '');
	// Nodes moved in the hierarchy
	for (let node of unmatched) {
		let candidates = by_name.get(baseName(node))?.filter(c => !used.has(c) && sameKind(c, node));
		if (candidates?.length === 1) copy(candidates[0], node);
	}
}

/** Group.remove() drops a node's animators, so keep them for nodes that come back with the same uuid */
export function stashAnimators(): AnimatorStash {
	let stash: AnimatorStash = [];
	for (let animation of Animator.animations) {
		for (let uuid in animation.animators) stash.push([animation, uuid, animation.animators[uuid]]);
	}
	return stash;
}
export function restoreAnimators(stash: AnimatorStash) {
	for (let [animation, uuid, animator] of stash) {
		if (!animation.animators[uuid] && OutlinerNode.uuids[uuid]) animation.animators[uuid] = animator;
	}
}

/** Runs a rebuild of an attachment's nodes, then re-places the loaded attachments bound to it */
export function rebuildWithDependents(collection: Collection, rebuild: () => void) {
	let animators = stashAnimators();
	let dependents = getAttachDependents(collection).filter(c => !isUnloaded(c));
	let snapshots = dependents.map(c => Codecs.blockymodel.compile({attachment: c, raw: true, uuids: true}));
	// Their pieces may live inside this attachment's groups
	for (let dependent of dependents.slice().reverse()) {
		for (let child of dependent.getChildren()) child.remove();
	}
	rebuild();
	dependents.forEach((dependent, i) => parseAttachmentJson(dependent, snapshots[i], dependent.export_path));
	restoreAnimators(animators);
	Canvas.updateAllFaces();
}

/** Re-parses an attachment from JSON (by default its current state), applying a change in between. Unloaded attachments only take the change */
export function reparseAttachment(collection: Collection, change?: () => void, json?: any) {
	if (isUnloaded(collection)) return change?.();
	rebuildWithDependents(collection, () => {
		json ??= Codecs.blockymodel.compile({attachment: collection, raw: true, uuids: true});
		for (let child of collection.getChildren()) child.remove();
		change?.();
		parseAttachmentJson(collection, json, collection.export_path);
	});
}
