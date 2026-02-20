//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { isHytaleFormat } from "./formats";

/**
 * Override "Add Group" to create a bone from selected cube.
 * When a cube is selected, "Add Group" extracts the rotation into a new parent bone,
 * making the cube a "main shape" (rotation [0,0,0]).
 * Bakes world transforms so it works correctly in nested cube hierarchies.
 */

export function setupCreateBoneFromCube() {
	const addGroupAction = BarItems.add_group as Action;
	const originalClick = addGroupAction.click;

	addGroupAction.click = function(event: Event) {
		// Only intercept when in Hytale format with a cube selected (and no group selected)
		if (!isHytaleFormat() || Cube.selected.length !== 1 || Group.selected.length > 0) {
			return originalClick.call(this, event);
		}

		const cube = Cube.selected[0];

		// Remember original parent for refresh
		const originalParent = cube.parent;

		Undo.initEdit({ outliner: true, elements: [cube], selection: true });

		// Find the nearest Group parent (Groups should only parent to Groups, not Cubes)
		let groupParent: Group | null = null;
		let current: any = cube.parent;
		while (current) {
			if (current instanceof Group) {
				groupParent = current;
				break;
			}
			current = current.parent;
		}

		// Force update matrices to get accurate world transforms
		cube.mesh.updateMatrixWorld(true);

		// Get cube's world origin position and rotation
		const worldOrigin = new THREE.Vector3();
		cube.mesh.getWorldPosition(worldOrigin);

		const worldQuat = new THREE.Quaternion();
		cube.mesh.getWorldQuaternion(worldQuat);

		// Calculate bone's local transform relative to its parent group
		let boneOrigin: ArrayVector3;
		let boneRotation: ArrayVector3;

		if (groupParent) {
			groupParent.mesh.updateMatrixWorld(true);

			// Get parent group's world transform
			const parentWorldPos = new THREE.Vector3();
			const parentWorldQuat = new THREE.Quaternion();
			groupParent.mesh.getWorldPosition(parentWorldPos);
			groupParent.mesh.getWorldQuaternion(parentWorldQuat);

			// Calculate local origin: transform world origin to parent's local space
			const localOrigin = worldOrigin.clone().sub(parentWorldPos);
			const inverseParentQuat = parentWorldQuat.clone().invert();
			localOrigin.applyQuaternion(inverseParentQuat);

			// Calculate local rotation
			const localQuat = inverseParentQuat.clone().multiply(worldQuat);
			const localEuler = new THREE.Euler().setFromQuaternion(localQuat, 'ZYX');

			// Add parent's origin offset (bone coords are relative to parent's origin)
			boneOrigin = [
				localOrigin.x + groupParent.origin[0],
				localOrigin.y + groupParent.origin[1],
				localOrigin.z + groupParent.origin[2]
			];

			boneRotation = [
				Math.roundTo(Math.radToDeg(localEuler.x), 4),
				Math.roundTo(Math.radToDeg(localEuler.y), 4),
				Math.roundTo(Math.radToDeg(localEuler.z), 4)
			];
		} else {
			// No parent group - use world transform directly
			const worldEuler = new THREE.Euler().setFromQuaternion(worldQuat, 'ZYX');

			boneOrigin = [worldOrigin.x, worldOrigin.y, worldOrigin.z];
			boneRotation = [
				Math.roundTo(Math.radToDeg(worldEuler.x), 4),
				Math.roundTo(Math.radToDeg(worldEuler.y), 4),
				Math.roundTo(Math.radToDeg(worldEuler.z), 4)
			];
		}

		// Create new group with baked world transform
		const newBone = new Group({
			name: cube.name,
			origin: boneOrigin,
			rotation: boneRotation,
			color: cube.color
		}).init();

		// Add the new bone to the nearest Group parent (or root if none)
		if (groupParent) {
			newBone.addTo(groupParent);
		}

		// Reset cube to be a main shape: zero rotation, origin at bone's origin
		// Preserve the offset from origin to from/to (the cube's shape relative to pivot)
		const fromOffset = [
			cube.from[0] - cube.origin[0],
			cube.from[1] - cube.origin[1],
			cube.from[2] - cube.origin[2]
		];
		const toOffset = [
			cube.to[0] - cube.origin[0],
			cube.to[1] - cube.origin[1],
			cube.to[2] - cube.origin[2]
		];

		// Set cube's origin to match bone's origin
		cube.origin[0] = newBone.origin[0];
		cube.origin[1] = newBone.origin[1];
		cube.origin[2] = newBone.origin[2];

		// Apply offsets to maintain shape
		cube.from[0] = cube.origin[0] + fromOffset[0];
		cube.from[1] = cube.origin[1] + fromOffset[1];
		cube.from[2] = cube.origin[2] + fromOffset[2];
		cube.to[0] = cube.origin[0] + toOffset[0];
		cube.to[1] = cube.origin[1] + toOffset[1];
		cube.to[2] = cube.origin[2] + toOffset[2];

		// Reset rotation to zero
		cube.rotation[0] = 0;
		cube.rotation[1] = 0;
		cube.rotation[2] = 0;

		// Move cube into the new bone
		cube.addTo(newBone);

		// Update display
		cube.preview_controller.updateTransform(cube);
		cube.preview_controller.updateGeometry(cube);
		Canvas.updateAll();

		// Force outliner refresh on original parent (where cube was removed from)
		if (originalParent && typeof originalParent === 'object' && 'selected' in originalParent) {
			const wasSelected = originalParent.selected;
			originalParent.selected = !wasSelected;
			originalParent.selected = wasSelected;
		}

		// Select the new bone
		newBone.select();

		Undo.finishEdit('Create bone from cube', { outliner: true, elements: [cube], selection: true });
	};

	track({
		delete() {
			addGroupAction.click = originalClick;
		}
	});
}
