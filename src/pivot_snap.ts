//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";

// Vertex order from geometry buffer dedup:
//   0:(to,to,to) 1:(to,to,from) 2:(to,from,to) 3:(to,from,from)
//   4:(from,to,from) 5:(from,to,to) 6:(from,from,from) 7:(from,from,to)
const CORNER_COUNT = 8;

const CUBE_EDGES: [number, number][] = [
	[0, 1], [0, 5], [1, 4], [4, 5], // Top face
	[2, 3], [2, 7], [3, 6], [6, 7], // Bottom face
	[0, 2], [1, 3], [4, 6], [5, 7], // Vertical
];

const CUBE_FACES: number[][] = [
	[0, 1, 2, 3], // East  (x = to)
	[4, 5, 6, 7], // West  (x = from)
	[0, 1, 4, 5], // Up    (y = to)
	[2, 3, 6, 7], // Down  (y = from)
	[0, 2, 5, 7], // South (z = to)
	[1, 3, 4, 6], // North (z = from)
];

// Corner pairs that collapse when a dimension is flat (from[i] === to[i])
const COLLAPSE_PAIRS: [number, number][][] = [
	[[0, 5], [1, 4], [2, 7], [3, 6]], // X
	[[0, 2], [1, 3], [4, 6], [5, 7]], // Y
	[[0, 1], [2, 3], [4, 5], [6, 7]], // Z
];

type SnapPointMode = 'vertex' | 'edge' | 'face';

function getSnapTo(): SnapPointMode {
	return (BarItems.snap_to as BarSelect)?.value as SnapPointMode ?? 'vertex';
}

function getCornerMergeMap(element: any): Map<number, number> | null {
	let hasCollapse = false;
	let map = new Map<number, number>();
	for (let i = 0; i < CORNER_COUNT; i++) map.set(i, i);

	for (let dim = 0; dim < 3; dim++) {
		if (element.from[dim] !== element.to[dim]) continue;
		hasCollapse = true;
		for (let [a, b] of COLLAPSE_PAIRS[dim]) {
			let ca = map.get(a)!, cb = map.get(b)!;
			let keep = Math.min(ca, cb), drop = Math.max(ca, cb);
			if (keep === drop) continue;
			for (let [k, v] of map) {
				if (v === drop) map.set(k, keep);
			}
		}
	}
	return hasCollapse ? map : null;
}

function midpoint(a: number[], b: number[]): number[] {
	return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function buildSnapPoints(corners: number[][], mode: SnapPointMode, mergeMap?: Map<number, number> | null): number[][] {
	if (!mergeMap) {
		if (mode === 'vertex') return corners.slice();
		if (mode === 'edge') return CUBE_EDGES.map(([a, b]) => midpoint(corners[a], corners[b]));
		return CUBE_FACES.map(face => {
			let x = 0, y = 0, z = 0;
			for (let i of face) { x += corners[i][0]; y += corners[i][1]; z += corners[i][2]; }
			return [x / face.length, y / face.length, z / face.length];
		});
	}

	let canonicals = [...new Set(mergeMap.values())].sort((a, b) => a - b);

	if (mode === 'vertex') return canonicals.map(i => corners[i]);

	if (mode === 'edge') {
		let seen = new Set<string>();
		let points: number[][] = [];
		for (let [ai, bi] of CUBE_EDGES) {
			let ca = mergeMap.get(ai)!, cb = mergeMap.get(bi)!;
			if (ca === cb) continue;
			let key = Math.min(ca, cb) + ',' + Math.max(ca, cb);
			if (seen.has(key)) continue;
			seen.add(key);
			points.push(midpoint(corners[ca], corners[cb]));
		}
		return points;
	}

	let seen = new Set<string>();
	let points: number[][] = [];
	for (let face of CUBE_FACES) {
		let unique = [...new Set(face.map(i => mergeMap.get(i)!))].sort((a, b) => a - b);
		if (unique.length < 3) continue;
		let key = unique.join(',');
		if (seen.has(key)) continue;
		seen.add(key);
		let x = 0, y = 0, z = 0;
		for (let i of unique) { x += corners[i][0]; y += corners[i][1]; z += corners[i][2]; }
		points.push([x / unique.length, y / unique.length, z / unique.length]);
	}
	return points;
}

let _accentColor: THREE.Color | null = null;
let _sourceElement: any = null;

function getAccentColor(): THREE.Color {
	if (!_accentColor) {
		let css = getComputedStyle(document.body).getPropertyValue('--color-accent').trim();
		_accentColor = new THREE.Color(css || '#3e90ff');
	}
	return _accentColor;
}

function invalidateAccentColor() {
	_accentColor = null;
}

function rebuildPointsGeometry(pts: any, verts: number[][]) {
	let positions: number[] = [];
	let colors: number[] = [];
	let { r, g, b } = gizmo_colors.grid;

	for (let v of verts) {
		positions.push(v[0], v[1], v[2]);
		colors.push(r, g, b);
	}

	pts.vertices = verts;
	pts.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
	pts.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(colors), 3));
}

function recolorElementPoints(el: any, hoveredIndex: number) {
	let points = el.mesh?.vertex_points;
	if (!points) return;

	let colorAttr = points.geometry.attributes.color;
	if (!colorAttr) return;
	let arr = colorAttr.array;

	let sourceIdx = (!Vertexsnap.step1 && el === _sourceElement) ? Vertexsnap.vertex_index : -1;
	let count = points.geometry.attributes.position.count;
	for (let i = 0; i < count; i++) {
		let color;
		if (i === hoveredIndex) {
			color = gizmo_colors.outline;
		} else if (i === sourceIdx) {
			color = getAccentColor();
		} else {
			color = gizmo_colors.grid;
		}
		let offset = i * 3;
		arr[offset] = color.r;
		arr[offset + 1] = color.g;
		arr[offset + 2] = color.b;
	}
	colorAttr.needsUpdate = true;
}

// Reusable objects for per-frame raycasting to avoid allocations in mousemove
const _mouse = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();
const _camDir = new THREE.Vector3();
const _plane = new THREE.Plane();
const _target = new THREE.Vector3();

function projectMouseToPlane(event: MouseEvent, refPoint: THREE.Vector3): THREE.Vector3 | null {
	let preview: any = Preview.selected;
	if (!preview) return null;
	let canvasOffset = $(preview.canvas).offset();
	if (!canvasOffset) return null;

	_mouse.set(
		((event.clientX - canvasOffset.left) / preview.width) * 2 - 1,
		-((event.clientY - canvasOffset.top) / preview.height) * 2 + 1
	);
	_raycaster.setFromCamera(_mouse, preview.camera);
	preview.camera.getWorldDirection(_camDir);
	_plane.setFromNormalAndCoplanarPoint(_camDir, refPoint);

	return _raycaster.ray.intersectPlane(_plane, _target) ? _target.clone() : null;
}

// Overrides are intentionally global (not gated to Hytale formats) — edge/face
// snapping and guide lines enhance the vertex snap tool for all format types.
export function setupPivotSnap() {
	let previewEl: HTMLElement | undefined;
	let _prevHoveredEl: any = null;
	let guideLine = new THREE.Line(
		new THREE.BufferGeometry(),
		new THREE.LineBasicMaterial({ color: getAccentColor(), depthTest: false, transparent: true })
	);
	guideLine.renderOrder = 901;
	guideLine.frustumCulled = false;

	let sourceMarker = new THREE.Points(
		new THREE.BufferGeometry(),
		new THREE.PointsMaterial({
			size: 7,
			sizeAttenuation: false,
			color: getAccentColor(),
			depthTest: false,
			transparent: true,
		})
	);
	sourceMarker.renderOrder = 901;
	sourceMarker.frustumCulled = false;

	function updateAccentColors() {
		invalidateAccentColor();
		let color = getAccentColor();
		(guideLine.material as THREE.LineBasicMaterial).color.copy(color);
		(sourceMarker.material as THREE.PointsMaterial).color.copy(color);
	}

	function showSourceMarker(pos: THREE.Vector3) {
		sourceMarker.geometry.setAttribute('position', new THREE.BufferAttribute(
			new Float32Array(pos.toArray()), 3
		));
		Project.model_3d.add(sourceMarker);
		sourceMarker.position.copy(scene.position).multiplyScalar(-1);
	}

	function removeSourceMarker() {
		Project.model_3d.remove(sourceMarker);
	}

	function removeGuideLine() {
		Project.model_3d.remove(guideLine);
	}

	function resetSnapVisuals() {
		removeGuideLine();
		removeSourceMarker();
		_parentPivotGroup = null;
		_sourceElement = null;
	}

	function drawGuideLine(start: THREE.Vector3, end: THREE.Vector3) {
		guideLine.geometry.setAttribute('position', new THREE.BufferAttribute(
			new Float32Array([...start.toArray(), ...end.toArray()]), 3
		));
		Project.model_3d.add(guideLine);
		guideLine.position.copy(scene.position).multiplyScalar(-1);
	}

	function getPreviewEl(): HTMLElement | undefined {
		if (!previewEl) previewEl = $('#preview').get(0) as HTMLElement | undefined;
		return previewEl;
	}

	function addHoverListener() {
		let el = getPreviewEl();
		if (el) {
			el.removeEventListener('mousemove', Vertexsnap.hoverCanvas);
			el.addEventListener('mousemove', Vertexsnap.hoverCanvas);
		}
	}

	function enterStep2(pos: THREE.Vector3) {
		showSourceMarker(pos);
		addHoverListener();
		$('#preview').css('cursor', 'alias');
		Blockbench.setStatusBarText();
	}

	function enterStep1() {
		resetSnapVisuals();
		Vertexsnap.step1 = true;
		$('#preview').css('cursor', 'copy');
		Blockbench.setStatusBarText();
	}

	// --- Override addVertices ---
	let originalAddVertices = Vertexsnap.addVertices;

	Vertexsnap.addVertices = function (element: any) {
		originalAddVertices.call(this, element);

		let { mesh } = element;
		if (!mesh?.vertex_points) return;
		if (!(element instanceof Cube)) return;

		let pts = mesh.vertex_points;
		let verts: number[][] = pts.vertices;
		if (verts.length < CORNER_COUNT + 1) return;

		let corners = verts.slice(0, CORNER_COUNT);
		pts._snap_corners = corners;

		let mergeMap = getCornerMergeMap(element);
		let snapPoints = buildSnapPoints(corners, getSnapTo(), mergeMap);
		let allPoints = [...snapPoints, [0, 0, 0]];

		pts._parent_pivot_index = null;
		let parentGroup = element.parent;
		if (parentGroup instanceof Group && parentGroup.mesh) {
			let groupWorldPos = new THREE.Vector3();
			parentGroup.mesh.getWorldPosition(groupWorldPos);
			let localPos = mesh.worldToLocal(groupWorldPos.clone());
			pts._parent_pivot_index = allPoints.length;
			allPoints.push(localPos.toArray());
		}

		rebuildPointsGeometry(pts, allPoints);
		pts.renderOrder = 901;
		pts.material.depthTest = false;

		if (!Vertexsnap.step1 && element === _sourceElement) {
			let idx = Vertexsnap.vertex_index;
			let colorAttr = pts.geometry.attributes.color;
			if (idx >= 0 && idx < allPoints.length && colorAttr) {
				let accent = getAccentColor();
				let offset = idx * 3;
				colorAttr.array[offset] = accent.r;
				colorAttr.array[offset + 1] = accent.g;
				colorAttr.array[offset + 2] = accent.b;
				colorAttr.needsUpdate = true;
			}
		}
	};

	// --- Override clearVertexGizmos ---
	let originalClearVertexGizmos = Vertexsnap.clearVertexGizmos;

	Vertexsnap.clearVertexGizmos = function () {
		removeGuideLine();
		_prevHoveredEl = null;
		originalClearVertexGizmos.call(this);
		// Keep hover listener alive during step 2 so guide line persists across selection changes
		if (!Vertexsnap.step1) {
			addHoverListener();
		}
	};

	// --- Override canvasClick ---
	let originalCanvasClick = Vertexsnap.canvasClick;
	let _parentPivotGroup: any = null;

	Vertexsnap.canvasClick = function (data: any) {
		// Step 1: pick parent group pivot as snap source
		if (data?.type === 'vertex' && Vertexsnap.step1) {
			let pts = data.element?.mesh?.vertex_points;
			if (pts?._parent_pivot_index != null && data.vertex_index === pts._parent_pivot_index) {
				let parentGroup = data.element.parent;
				if (parentGroup instanceof Group) {
					Vertexsnap.step1 = false;
					Vertexsnap.vertex_pos = Vertexsnap.getGlobalVertexPos(data.element, data.vertex);
					Vertexsnap.vertex_index = data.vertex_index;
					_sourceElement = data.element;
					_parentPivotGroup = parentGroup;
					Vertexsnap.clearVertexGizmos();
					enterStep2(Vertexsnap.vertex_pos);
					return;
				}
			}
		}

		// Step 2: snap parent group pivot to target
		if (!Vertexsnap.step1 && _parentPivotGroup) {
			if (!data) return;
			if (data.type !== 'vertex' && !['locator', 'null_object'].includes(data.element?.type)) return;

			let group = _parentPivotGroup;
			let allGroups: any[] = [group];
			group.forEachChild((child: any) => { allGroups.push(child); }, Group);
			let elements: any[] = [];
			group.forEachChild((child: any) => { elements.push(child); }, OutlinerElement);

			Undo.initEdit({ elements, groups: allGroups, outliner: true });

			let vec = Vertexsnap.getGlobalVertexPos(data.element, data.vertex);
			if (Format.bone_rig && group.parent instanceof Group && group.mesh.parent) {
				group.mesh.parent.worldToLocal(vec);
			}
			let vec_array: any = vec.toArray();
			if (group.parent instanceof Group) {
				vec_array.V3_add(group.parent.origin);
			}

			group.transferOrigin(vec_array);
			Canvas.updateAllBones(allGroups);
			Canvas.updateView({
				elements,
				element_aspects: { transform: true, geometry: true },
				selection: true,
			});

			Undo.finishEdit('Use vertex snap');
			enterStep1();
			return;
		}

		let wasStep1 = Vertexsnap.step1;
		originalCanvasClick.call(this, data);

		if (wasStep1 && !Vertexsnap.step1) {
			_sourceElement = data?.element;
			showSourceMarker(Vertexsnap.vertex_pos);
			addHoverListener();
		} else if (!wasStep1 && Vertexsnap.step1) {
			resetSnapVisuals();
		}
	};

	// --- Override hoverCanvas ---
	let originalHoverCanvas = Vertexsnap.hoverCanvas;

	Vertexsnap.hoverCanvas = function (event: any) {
		let data = Canvas.raycast(event);

		if (Vertexsnap.hovering) {
			Project.model_3d.remove(Vertexsnap.line);
			removeGuideLine();

			if (_prevHoveredEl) {
				recolorElementPoints(_prevHoveredEl, -1);
				_prevHoveredEl = null;
			}
		}

		let hoveredEl = data?.element;
		if (hoveredEl?.mesh?.vertex_points) {
			if (data.type === 'vertex') {
				recolorElementPoints(hoveredEl, data.vertex_index);
			}
			_prevHoveredEl = hoveredEl;
		}

		// Guide line from source to cursor/target (step 2)
		if (!Vertexsnap.step1 && Vertexsnap.vertex_pos) {
			let endPos: THREE.Vector3 | null = null;

			if (data && data.type === 'vertex') {
				endPos = Vertexsnap.getGlobalVertexPos(data.element, data.vertex);
				let diff = new THREE.Vector3().copy(Vertexsnap.vertex_pos).sub(endPos);
				Blockbench.setStatusBarText(tl('status_bar.vertex_distance', [trimFloatNumber(diff.length())]));
			} else {
				endPos = projectMouseToPlane(event, Vertexsnap.vertex_pos);
			}

			if (endPos) {
				drawGuideLine(Vertexsnap.vertex_pos, endPos);
			}

			Vertexsnap.hovering = true;
			return;
		}

		if (!data || data.type !== 'vertex') {
			Blockbench.setStatusBarText();
			return;
		}
		Vertexsnap.hovering = true;
	};

	// --- Escape to cancel step 2 ---
	function cancelSnap() {
		if (Vertexsnap.step1) return;
		Vertexsnap.hovering = false;
		enterStep1();
		Vertexsnap.select();
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape' && !Vertexsnap.step1 && Toolbox.selected?.id === 'vertex_snap_tool') {
			event.stopPropagation();
			cancelSnap();
		}
	}

	document.addEventListener('keydown', onKeyDown, true);

	// --- Snap mode selector ---
	let snapTo = new BarSelect('snap_to', {
		name: 'Vertex Snap To',
		options: {
			vertex: { name: 'Vertex', icon: 'fiber_manual_record' },
			edge: { name: 'Edge', icon: 'pen_size_3' },
			face: { name: 'Face', icon: 'far.fa-square' },
		},
		icon_mode: true,
		condition: () => Toolbox.selected?.id === 'vertex_snap_tool',
		onChange() {
			Vertexsnap.clearVertexGizmos();
			Vertexsnap.select();
		}
	});
	track(snapTo);

	let toolbar = Toolbars.vertex_snap;
	if (toolbar) {
		let origChildren = toolbar.default_children.slice();
		toolbar.default_children = [...origChildren.slice(0, 1), 'snap_to', ...origChildren.slice(1)];
		toolbar.build({ children: toolbar.default_children });
		track({
			delete() {
				toolbar.default_children = origChildren;
				toolbar.build({ children: origChildren });
			}
		});
	}

	// Refresh accent-colored materials when selection changes (proxy for theme changes)
	Blockbench.on('update_selection', updateAccentColors);

	track({
		delete() {
			Vertexsnap.addVertices = originalAddVertices;
			Vertexsnap.canvasClick = originalCanvasClick;
			Vertexsnap.hoverCanvas = originalHoverCanvas;
			Vertexsnap.clearVertexGizmos = originalClearVertexGizmos;
			document.removeEventListener('keydown', onKeyDown, true);
			Blockbench.removeListener('update_selection', updateAccentColors);
			resetSnapVisuals();
			invalidateAccentColor();
			guideLine.geometry.dispose();
			(guideLine.material as THREE.LineBasicMaterial).dispose();
			sourceMarker.geometry.dispose();
			(sourceMarker.material as THREE.PointsMaterial).dispose();
		}
	});
}
