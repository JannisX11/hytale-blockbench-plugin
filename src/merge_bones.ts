//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";

/**
 * Merge Bones: Combines multiple parented bones into one.
 * Useful for rigid structures (horns, props) that were modeled with multiple bones
 * but only need one for animation.
 */

/**
 * Find the topmost bone among selected bones (the one that will remain)
 */
function findTargetBone(groups: Group[]): Group | null {
	// Find bone that is not a child of any other selected bone
	for (let group of groups) {
		let isChild = groups.some(other =>
			other !== group && group.isChildOf(other, 100)
		);
		if (!isChild) return group;
	}
	return groups[0];
}

/**
 * Collect all cubes from a bone (direct children only, not recursive)
 */
function collectDirectCubes(group: Group): Cube[] {
	return group.children.filter(c => c instanceof Cube) as Cube[];
}

/**
 * Bake world transform into cube's local transform relative to target bone.
 * The cube should visually stay in the exact same place.
 */
function bakeCubeTransform(cube: Cube, targetBone: Group) {
	// Force update all matrices
	cube.mesh.updateMatrixWorld(true);
	targetBone.mesh.updateMatrixWorld(true);

	// Get cube's current world origin position
	let worldOrigin = new THREE.Vector3();
	cube.mesh.getWorldPosition(worldOrigin);

	// Get cube's current world rotation
	let worldQuat = new THREE.Quaternion();
	cube.mesh.getWorldQuaternion(worldQuat);

	// Get target bone's world transform
	let targetWorldPos = new THREE.Vector3();
	let targetWorldQuat = new THREE.Quaternion();
	targetBone.mesh.getWorldPosition(targetWorldPos);
	targetBone.mesh.getWorldQuaternion(targetWorldQuat);

	// Calculate new local origin: transform world origin to target's local space
	// localOrigin = inverseTargetRotation * (worldOrigin - targetWorldPos)
	let localOrigin = worldOrigin.clone().sub(targetWorldPos);
	let inverseTargetQuat = targetWorldQuat.clone().invert();
	localOrigin.applyQuaternion(inverseTargetQuat);

	// Calculate new local rotation
	let localQuat = inverseTargetQuat.clone().multiply(worldQuat);
	let localEuler = new THREE.Euler().setFromQuaternion(localQuat, 'ZYX');

	// Preserve the offset from origin to from/to (the cube's shape relative to pivot)
	let fromOffset = [
		cube.from[0] - cube.origin[0],
		cube.from[1] - cube.origin[1],
		cube.from[2] - cube.origin[2]
	];
	let toOffset = [
		cube.to[0] - cube.origin[0],
		cube.to[1] - cube.origin[1],
		cube.to[2] - cube.origin[2]
	];

	// Apply new origin (add targetBone.origin because cube coords are relative to parent's origin)
	cube.origin[0] = localOrigin.x + targetBone.origin[0];
	cube.origin[1] = localOrigin.y + targetBone.origin[1];
	cube.origin[2] = localOrigin.z + targetBone.origin[2];

	// Apply new from/to (same offset from new origin)
	cube.from[0] = cube.origin[0] + fromOffset[0];
	cube.from[1] = cube.origin[1] + fromOffset[1];
	cube.from[2] = cube.origin[2] + fromOffset[2];
	cube.to[0] = cube.origin[0] + toOffset[0];
	cube.to[1] = cube.origin[1] + toOffset[1];
	cube.to[2] = cube.origin[2] + toOffset[2];

	// Apply new rotation
	cube.rotation[0] = Math.roundTo(Math.radToDeg(localEuler.x), 4);
	cube.rotation[1] = Math.roundTo(Math.radToDeg(localEuler.y), 4);
	cube.rotation[2] = Math.roundTo(Math.radToDeg(localEuler.z), 4);
}

/**
 * Recursively delete a group and all its child groups if they become empty
 */
function deleteEmptyGroups(groups: Group[], targetBone: Group) {
	// Sort by depth (deepest first) to delete children before parents
	let sortedGroups = groups
		.filter(g => g !== targetBone)
		.sort((a, b) => {
			let depthA = 0, depthB = 0;
			let parent = a.parent;
			while (parent instanceof Group) { depthA++; parent = parent.parent; }
			parent = b.parent;
			while (parent instanceof Group) { depthB++; parent = parent.parent; }
			return depthB - depthA;
		});

	for (let group of sortedGroups) {
		let hasChildren = group.children.some(c =>
			c instanceof Cube || c instanceof Group
		);
		if (!hasChildren) {
			group.remove(false);
		}
	}
}

export function setupMergeBones() {
	let action = new Action('hytale_merge_bones', {
		name: 'Merge Bones',
		icon: 'merge',
		category: 'edit',
		condition: () => {
			if (!isHytaleFormat()) return false;
			if (!Modes.edit) return false;
			// Allow if 2+ groups are selected (ignore cubes in selection)
			return Group.selected.length >= 2;
		},
		click() {
			// Only process groups, ignore any selected cubes
			let selectedGroups = Group.selected.slice();
			let targetBone = findTargetBone(selectedGroups);
			if (!targetBone) return;

			Undo.initEdit({ outliner: true, elements: Cube.all, selection: true });

			// Collect all cubes from all selected bones (direct children only)
			let allCubes: { cube: Cube, originalParent: Group }[] = [];
			for (let group of selectedGroups) {
				for (let cube of collectDirectCubes(group)) {
					allCubes.push({ cube, originalParent: group });
				}
			}

			// Bake transforms and move cubes to target bone
			for (let { cube, originalParent } of allCubes) {
				if (originalParent === targetBone) continue;
				bakeCubeTransform(cube, targetBone);
				cube.addTo(targetBone);
				// Update the cube's mesh after transform changes
				cube.preview_controller.updateTransform(cube);
				cube.preview_controller.updateGeometry(cube);
			}

			// Delete empty bones (except target)
			deleteEmptyGroups(selectedGroups, targetBone);

			// Update display
			Canvas.updateAll();
			targetBone.select();

			Undo.finishEdit('Merge bones', { outliner: true, elements: Cube.all, selection: true });
		}
	});

	track(action);

	// Add to group context menu (right-click)
	Group.prototype.menu.addAction(action, '#manage');
}
