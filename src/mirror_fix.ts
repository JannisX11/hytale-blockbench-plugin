//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { isHytaleFormat } from "./formats";

const SNAP_EPSILON = 0.01;

function snapAncestors(element: OutlinerNode) {
	if (!isHytaleFormat()) return;

	let center = Format.centered_grid ? 0 : 8;
	let node = element.parent;
	while (node instanceof Group) {
		if (node.origin[0] !== center && Math.abs(node.origin[0] - center) < SNAP_EPSILON) {
			node.origin[0] = center;
		}
		if (node.rotation[1] !== 0 && Math.abs(node.rotation[1]) < SNAP_EPSILON) {
			node.rotation[1] = 0;
		}
		if (node.rotation[2] !== 0 && Math.abs(node.rotation[2]) < SNAP_EPSILON) {
			node.rotation[2] = 0;
		}
		node = node.parent;
	}
}

function hasDescendantElements(group: Group): boolean {
	for (let child of group.children) {
		if (child instanceof OutlinerElement) return true;
		if (child instanceof Group && hasDescendantElements(child)) return true;
	}
	return false;
}

function isAncestrySymmetrical(child: OutlinerNode, center: number): boolean {
	let node = child.parent;
	while (node instanceof Group) {
		if (Math.abs(node.origin[0] - center) >= SNAP_EPSILON) return false;
		if (Math.abs(node.rotation[1]) >= SNAP_EPSILON) return false;
		if (Math.abs(node.rotation[2]) >= SNAP_EPSILON) return false;
		node = node.parent;
	}
	return true;
}

// Replicates getParentMirror from Blockbench's mirror_modeling.ts:
// walks up the parent chain, reusing symmetrical parents and finding/creating
// mirror copies of asymmetrical ones.
function findOrCreateMirrorParent(child: OutlinerNode, center: number): Group | string {
	let parent = child.parent;
	if (!(parent instanceof Group)) return 'root';

	if (Math.abs(parent.origin[0] - center) < SNAP_EPSILON && isAncestrySymmetrical(child, center)) {
		return parent;
	}

	let mirrorGrandparent = findOrCreateMirrorParent(parent, center);

	let mirrorOriginX = MirrorModeling.flipCoord(parent.origin[0]);
	let mirrorRotY = -parent.rotation[1];
	let mirrorRotZ = -parent.rotation[2];

	let searchList: OutlinerNode[] = mirrorGrandparent instanceof Group
		? mirrorGrandparent.children
		: Outliner.root;

	let match = searchList.find(node => {
		if (!(node instanceof Group)) return false;
		if (!(node as any).origin.equals) return false;
		return Math.epsilon(node.origin[0], mirrorOriginX) &&
			Math.epsilon(node.origin[1], parent.origin[1]) &&
			Math.epsilon(node.origin[2], parent.origin[2]) &&
			Math.epsilon(node.rotation[1], mirrorRotY) &&
			Math.epsilon(node.rotation[2], mirrorRotZ);
	});

	if (match) return match as Group;

	let mirror = new Group(parent);
	flipGroupName(mirror);
	mirror.origin[0] = mirrorOriginX;
	mirror.rotation[1] = mirrorRotY;
	mirror.rotation[2] = mirrorRotZ;
	mirror.isOpen = parent.isOpen;
	mirror.addTo(mirrorGrandparent).init();
	mirror.createUniqueName();

	return mirror;
}

function flipGroupName(node: { name: string }) {
	const pairs: Record<string, string> = {
		right: 'left', Right: 'Left', RIGHT: 'LEFT',
		R: 'L', r: 'l',
	};
	for (let [a, b] of Object.entries(pairs)) {
		if (tryReplaceName(node, a, b)) return;
		if (tryReplaceName(node, b, a)) return;
	}
}

function tryReplaceName(node: { name: string }, from: string, to: string): boolean {
	if (!node.name.includes(from)) return false;
	let regex: RegExp | string = from;
	if (from.length === 1) {
		regex = new RegExp(`(?<=^|[_. -])${from}(?=[_. -]|$)`);
	}
	let result = node.name.replace(regex, to);
	if (result === node.name) return false;
	node.name = result;
	return true;
}

function mirrorGroupTree(source: Group, targetParent: Group | string, center: number) {
	let mirrorOriginX = MirrorModeling.flipCoord(source.origin[0]);

	let searchList: OutlinerNode[] = targetParent instanceof Group
		? targetParent.children
		: Outliner.root;
	let exists = searchList.some(node =>
		node instanceof Group &&
		Math.epsilon(node.origin[0], mirrorOriginX) &&
		Math.epsilon(node.origin[1], source.origin[1]) &&
		Math.epsilon(node.origin[2], source.origin[2])
	);
	if (exists) return;

	let mirror = new Group(source);
	flipGroupName(mirror);
	mirror.origin[0] = mirrorOriginX;
	mirror.rotation[1] *= -1;
	mirror.rotation[2] *= -1;
	mirror.isOpen = source.isOpen;
	mirror.addTo(targetParent).init();
	mirror.createUniqueName();

	for (let child of source.children) {
		if (child instanceof Group) {
			mirrorGroupTree(child, mirror, center);
		}
	}
}

export function setupMirrorFix() {
	const origIsCentered = MirrorModeling.isCentered;
	MirrorModeling.isCentered = function (element: OutlinerElement) {
		snapAncestors(element);
		return origIsCentered(element);
	};

	const origCreateClone = MirrorModeling.createClone;
	MirrorModeling.createClone = function (original: OutlinerElement, undo_aspects: UndoAspects) {
		snapAncestors(original);
		return origCreateClone(original, undo_aspects);
	};

	let action = BarItems.apply_mirror_modeling as Action;
	let origClick = action.click;
	action.click = function (...args: any[]) {
		if (!isHytaleFormat()) return origClick.apply(this, args);

		let center = Format.centered_grid ? 0 : 8;
		let toggle = BarItems.mirror_modeling as Toggle;
		let valueBefore = toggle.value;
		toggle.value = true;

		let selectedGroups = Group.all.filter(g => g.selected);
		let emptyGroups = selectedGroups.filter(g => !hasDescendantElements(g));

		Undo.initEdit({
			elements: Outliner.selected,
			groups: Group.selected,
			outliner: true,
		});

		for (let group of emptyGroups) {
			snapAncestors(group);

			let isCentered = Math.abs(group.origin[0] - center) < SNAP_EPSILON
				&& isAncestrySymmetrical(group, center);
			if (isCentered) continue;

			let mirrorParent = findOrCreateMirrorParent(group, center);
			mirrorGroupTree(group, mirrorParent, center);
		}

		Undo.finishEdit('Applied mirror modeling');
		toggle.value = valueBefore;
	};

	track({
		delete() {
			MirrorModeling.isCentered = origIsCentered;
			MirrorModeling.createClone = origCreateClone;
			action.click = origClick;
		}
	});
}
