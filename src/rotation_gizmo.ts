//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { isHytaleFormat } from "./formats";

type DialAxis = 'X' | 'Y' | 'Z' | 'E';
type DragState = {
	axis: DialAxis
	frozenQuat: THREE.Quaternion
	basisQuat: THREE.Quaternion | null
	lastValue: number | null
	total: number
};

const ARC_STEP = 5;
const ARC_MAX_SEGMENTS = 360 / ARC_STEP;
const TICK_MIN_INTERVAL = 5;
const TICK_RADIUS = [1.06, 1.16];
const FILL_OPACITY = 0.25;
const RENDER_ORDER = 1000;

/** Blender-style rotation dial: while dragging a ring, show only that ring with the swept angle and snap ticks */
export function setupRotationGizmo() {
	let rotateGizmo: RotateGizmo | undefined = Transformer.children.find((child: THREE.Object3D) => {
		return 'handleGizmos' in child && 'XYZE' in (child as RotateGizmo).handleGizmos;
	});
	if (!rotateGizmo) return;

	function overlayMaterial<T extends THREE.Material>(material: T): T {
		material.depthTest = false;
		material.depthWrite = false;
		material.transparent = true;
		return material;
	}
	function circlePoints(radius: number, segments: number) {
		let points: number[] = [];
		for (let i = 0; i < segments; i++) {
			let a = i / segments * Math.PI * 2;
			points.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
		}
		return points;
	}

	let lineMaterial = overlayMaterial(new THREE.LineBasicMaterial());
	let fillMaterial = overlayMaterial(new THREE.MeshBasicMaterial({side: THREE.DoubleSide, opacity: FILL_OPACITY}));

	let ringGeometry = new THREE.BufferGeometry();
	ringGeometry.setAttribute('position', new THREE.Float32BufferAttribute(circlePoints(1, 64), 3));
	let ring = new THREE.LineLoop(ringGeometry, lineMaterial);

	// Fan from the center, grown up to ARC_MAX_SEGMENTS via draw range
	let arcGeometry = new THREE.BufferGeometry();
	arcGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((ARC_MAX_SEGMENTS + 2) * 3), 3));
	let arcIndex: number[] = [];
	for (let i = 1; i <= ARC_MAX_SEGMENTS; i++) arcIndex.push(0, i, i + 1);
	arcGeometry.setIndex(arcIndex);
	let arc = new THREE.Mesh(arcGeometry, fillMaterial);

	// Shown under the arc once the rotation passes a full turn
	let diskGeometry = new THREE.BufferGeometry();
	diskGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, ...circlePoints(1, 64)], 3));
	let diskIndex: number[] = [];
	for (let i = 1; i <= 64; i++) diskIndex.push(0, i, i % 64 + 1);
	diskGeometry.setIndex(diskIndex);
	let disk = new THREE.Mesh(diskGeometry, fillMaterial);

	let spokesGeometry = new THREE.BufferGeometry();
	spokesGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0], 3));
	let spokes = new THREE.LineSegments(spokesGeometry, lineMaterial);

	let ticksGeometry = new THREE.BufferGeometry();
	let tickMaterial = overlayMaterial(new THREE.LineBasicMaterial({color: 0xffffff}));
	let ticks = new THREE.LineSegments(ticksGeometry, tickMaterial);
	let tickInterval = 0;

	let overlay = new THREE.Object3D();
	overlay.add(disk, arc, ring, spokes, ticks);
	overlay.children.forEach(child => child.renderOrder = RENDER_ORDER);
	overlay.visible = false;
	// Child of the rotate gizmo so it shares its 0.8 scale
	rotateGizmo.add(overlay);

	let drag: DragState | null = null;

	function isActive() {
		return isHytaleFormat() && Modes.edit && Toolbox.selected.transformerMode === 'rotate';
	}

	function setTicks(interval: number) {
		if (interval === tickInterval) return;
		tickInterval = interval;
		let points: number[] = [];
		for (let a = 0; a < 360 - 1e-6; a += interval) {
			let cos = Math.cos(Math.degToRad(a)), sin = Math.sin(Math.degToRad(a));
			points.push(cos * TICK_RADIUS[0], sin * TICK_RADIUS[0], 0, cos * TICK_RADIUS[1], sin * TICK_RADIUS[1], 0);
		}
		ticksGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
	}

	function setArc(angle: number) {
		let turns = Math.floor(Math.abs(angle) / 360);
		let remainder = Math.sign(angle) * (Math.abs(angle) % 360);
		let segments = Math.max(1, Math.ceil(Math.abs(remainder) / ARC_STEP));
		let positions = arcGeometry.getAttribute('position') as THREE.BufferAttribute;
		positions.setXYZ(0, 0, 0, 0);
		for (let i = 0; i <= segments; i++) {
			let a = Math.degToRad(remainder * i / segments);
			positions.setXYZ(i + 1, Math.cos(a), Math.sin(a), 0);
		}
		positions.needsUpdate = true;
		arcGeometry.setDrawRange(0, segments * 3);
		disk.visible = turns > 0;

		let spokePositions = spokesGeometry.getAttribute('position') as THREE.BufferAttribute;
		spokePositions.setXYZ(3, Math.cos(Math.degToRad(angle)), Math.sin(Math.degToRad(angle)), 0);
		spokePositions.needsUpdate = true;
	}

	/** Frame whose XY plane is the dial, X at the drag start and Z along the rotation axis */
	function getBasis(axis: DialAxis, frozenQuat: THREE.Quaternion, startAngle: number) {
		let a = Math.degToRad(startAngle);
		let start: THREE.Vector3, normal: THREE.Vector3;
		if (axis === 'E') {
			let planeQuat = frozenQuat.clone().multiply(rotateGizmo.activePlane.quaternion);
			start = new THREE.Vector3(Math.cos(a), Math.sin(a), 0).applyQuaternion(planeQuat);
			normal = new THREE.Vector3(0, 0, 1).applyQuaternion(planeQuat);
		} else {
			// Mirrors the angle math in the gizmo's onPointerMove
			start = {
				X: new THREE.Vector3(0, Math.cos(a), Math.sin(a)),
				Y: new THREE.Vector3(Math.sin(a), 0, Math.cos(a)),
				Z: new THREE.Vector3(Math.cos(a), Math.sin(a), 0),
			}[axis].applyQuaternion(frozenQuat);
			normal = new THREE.Vector3().setComponent('XYZ'.indexOf(axis), 1).applyQuaternion(frozenQuat);
		}
		let side = normal.clone().cross(start);
		return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(start, side, normal));
	}

	function show(axis: DialAxis) {
		lineMaterial.color.copy(axis === 'E' ? gizmo_colors.outline : gizmo_colors['rgb'[['X', 'Y', 'Z'].indexOf(axis)]]);
		fillMaterial.color.copy(lineMaterial.color);
		overlay.scale.setScalar(axis === 'E' ? 1.2 : 1);
		overlay.visible = true;
		rotateGizmo.handles.visible = false;
	}

	function hide() {
		drag = null;
		overlay.visible = false;
		rotateGizmo.handles.visible = true;
	}

	let proto = TransformerModule.prototype;
	let original = {
		dispatchPointerDown: proto.dispatchPointerDown,
		dispatchMove: proto.dispatchMove,
		dispatchEnd: proto.dispatchEnd,
		dispatchCancel: proto.dispatchCancel,
	};

	proto.dispatchPointerDown = function(context) {
		original.dispatchPointerDown.call(this, context);
		hide();
		let axis = Transformer.axis;
		if (!isActive() || !['X', 'Y', 'Z', 'E'].includes(axis)) return;

		// Same reference frame the gizmo freezes for its angle math
		let frozenQuat = new THREE.Quaternion();
		if (Transformer.rotation_ref) {
			frozenQuat.setFromRotationMatrix(new THREE.Matrix4().extractRotation(Transformer.rotation_ref.matrixWorld));
		}
		drag = {axis, frozenQuat, basisQuat: null, lastValue: null, total: 0};
	};

	proto.dispatchMove = function(context) {
		original.dispatchMove.call(this, context);
		if (!drag || this.previous_value == null || context.angle == null) return;

		if (!drag.basisQuat) {
			drag.basisQuat = getBasis(drag.axis, drag.frozenQuat, context.angle);
			drag.lastValue = this.initial_value;
			show(drag.axis);
		}
		let difference = this.previous_value - drag.lastValue;
		if (difference > 180) difference -= 360;
		if (difference < -180) difference += 360;
		drag.total += difference;
		drag.lastValue = this.previous_value;

		rotateGizmo.getWorldQuaternion(overlay.quaternion).invert().multiply(drag.basisQuat);
		setArc(drag.total);
		let interval = getRotationInterval(context.event);
		ticks.visible = interval >= TICK_MIN_INTERVAL;
		if (ticks.visible) setTicks(interval);
	};

	proto.dispatchEnd = function(context) {
		original.dispatchEnd.call(this, context);
		hide();
	};

	proto.dispatchCancel = function(context) {
		original.dispatchCancel.call(this, context);
		hide();
	};

	track({
		delete() {
			hide();
			Object.assign(proto, original);
			rotateGizmo.remove(overlay);
			[ringGeometry, arcGeometry, diskGeometry, spokesGeometry, ticksGeometry].forEach(g => g.dispose());
			[lineMaterial, fillMaterial, tickMaterial].forEach(m => m.dispose());
		}
	});
}
