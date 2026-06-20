//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";

// Vertex order from geometry buffer dedup:
//   0:(to,to,to) 1:(to,to,from) 2:(to,from,to) 3:(to,from,from)
//   4:(from,to,from) 5:(from,to,to) 6:(from,from,from) 7:(from,from,to)
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

function midpoint(a: number[], b: number[]): number[] {
	return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function centroid(points: number[][]): number[] {
	let x = 0, y = 0, z = 0;
	for (let p of points) { x += p[0]; y += p[1]; z += p[2]; }
	let n = points.length;
	return [x / n, y / n, z / n];
}

type SnapPointMode = 'vertex' | 'edge' | 'face';

function getSnapTo(): SnapPointMode {
	return (BarItems.snap_to as any)?.value ?? 'vertex';
}

function buildSnapPoints(corners: number[][], mode: SnapPointMode): number[][] {
	let points: number[][] = [];

	if (mode === 'vertex') {
		points.push(...corners);
	} else if (mode === 'edge') {
		for (let [a, b] of CUBE_EDGES) {
			points.push(midpoint(corners[a], corners[b]));
		}
	} else {
		for (let face of CUBE_FACES) {
			points.push(centroid(face.map(i => corners[i])));
		}
	}

	return points;
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

let _accentColor: THREE.Color | null = null;
function getAccentColor(): THREE.Color {
	if (!_accentColor) {
		let css = getComputedStyle(document.body).getPropertyValue('--color-accent').trim();
		_accentColor = new THREE.Color(css || '#3e90ff');
	}
	return _accentColor;
}

function setParentPivotColor(pts: any) {
	if (pts._parent_pivot_index == null) return;
	let colorAttr = pts.geometry.attributes.color;
	if (!colorAttr) return;
	let idx = pts._parent_pivot_index * 3;
	if (idx + 2 >= colorAttr.array.length) return;
	let accent = getAccentColor();
	colorAttr.array[idx] = accent.r;
	colorAttr.array[idx + 1] = accent.g;
	colorAttr.array[idx + 2] = accent.b;
	colorAttr.needsUpdate = true;
}

function projectMouseToPlane(event: MouseEvent, refPoint: THREE.Vector3): THREE.Vector3 | null {
	let preview: any = Preview.selected;
	if (!preview) return null;
	let canvasOffset = $(preview.canvas).offset();
	if (!canvasOffset) return null;
	let mouse = new THREE.Vector2(
		((event.clientX - canvasOffset.left) / preview.width) * 2 - 1,
		-((event.clientY - canvasOffset.top) / preview.height) * 2 + 1
	);
	let raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(mouse, preview.camera);
	let camDir = new THREE.Vector3();
	preview.camera.getWorldDirection(camDir);
	let plane = new THREE.Plane();
	plane.setFromNormalAndCoplanarPoint(camDir, refPoint);
	let target = new THREE.Vector3();
	return raycaster.ray.intersectPlane(plane, target) ? target : null;
}

export function setupPivotSnap() {
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

	function drawGuideLine(start: THREE.Vector3, end: THREE.Vector3) {
		guideLine.geometry.setAttribute('position', new THREE.BufferAttribute(
			new Float32Array([...start.toArray(), ...end.toArray()]), 3
		));
		Project.model_3d.add(guideLine);
		guideLine.position.copy(scene.position).multiplyScalar(-1);
	}

	function addHoverListener() {
		let el = $('#preview').get(0);
		if (el) {
			el.removeEventListener('mousemove', Vertexsnap.hoverCanvas);
			el.addEventListener('mousemove', Vertexsnap.hoverCanvas);
		}
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
		if (verts.length < 9) return;

		let corners = verts.slice(0, 8);
		pts._snap_corners = corners;

		let mode = getSnapTo();
		let snapPoints = buildSnapPoints(corners, mode);
		let origin = [0, 0, 0];
		let allPoints = [...snapPoints, origin];

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
		setParentPivotColor(pts);
		if (pts._parent_pivot_index != null) {
			pts.renderOrder = 901;
		}
	};

	// --- Override clearVertexGizmos ---
	let originalClearVertexGizmos = Vertexsnap.clearVertexGizmos;
	Vertexsnap.clearVertexGizmos = function () {
		removeGuideLine();
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
					_parentPivotGroup = parentGroup;
					Vertexsnap.clearVertexGizmos();
					showSourceMarker(Vertexsnap.vertex_pos);
					addHoverListener();
					$('#preview').css('cursor', 'alias');
					Blockbench.setStatusBarText();
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

			removeGuideLine();
			removeSourceMarker();
			_parentPivotGroup = null;
			Vertexsnap.step1 = true;
			$('#preview').css('cursor', 'copy');
			Blockbench.setStatusBarText();
			return;
		}

		let wasStep1 = Vertexsnap.step1;
		originalCanvasClick.call(this, data);

		if (wasStep1 && !Vertexsnap.step1) {
			// Native step 1 completed: show source marker and re-add hover listener
			showSourceMarker(Vertexsnap.vertex_pos);
			addHoverListener();
		} else if (!wasStep1 && Vertexsnap.step1) {
			// Native step 2 completed
			removeGuideLine();
			removeSourceMarker();
		}
	};

	// --- Override hoverCanvas ---
	let originalHoverCanvas = Vertexsnap.hoverCanvas;
	Vertexsnap.hoverCanvas = function (event: any) {
		let data = Canvas.raycast(event);

		// Reset vertex colors and remove lines from previous frame
		if (Vertexsnap.hovering) {
			Project.model_3d.remove(Vertexsnap.line);
			removeGuideLine();

			for (let el of Vertexsnap.elements_with_vertex_gizmos) {
				let points = (el as any).mesh?.vertex_points;
				if (!points) continue;
				let colors: number[] = [];
				let count = points.geometry.attributes.position.count;
				for (let i = 0; i < count; i++) {
					let color;
					if (data && data.element == el && data.type == 'vertex' && data.vertex_index == i) {
						color = gizmo_colors.outline;
					} else if (points._parent_pivot_index != null && i === points._parent_pivot_index) {
						color = getAccentColor();
					} else {
						color = gizmo_colors.grid;
					}
					colors.push(color.r, color.g, color.b);
				}
				points.material.depthTest = !(data && data.element == el);
				points.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(colors), 3));
			}
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

	// --- Snap mode selector ---
	let snapTo = new BarSelect('snap_to', {
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
		toolbar.default_children.splice(1, 0, 'snap_to');
		toolbar.build({ children: toolbar.default_children });
		track({
			delete() {
				toolbar.default_children = origChildren;
				toolbar.build({ children: origChildren });
			}
		});
	}

	track({
		delete() {
			Vertexsnap.addVertices = originalAddVertices;
			Vertexsnap.canvasClick = originalCanvasClick;
			Vertexsnap.hoverCanvas = originalHoverCanvas;
			Vertexsnap.clearVertexGizmos = originalClearVertexGizmos;
			removeGuideLine();
			removeSourceMarker();
			guideLine.geometry.dispose();
			(guideLine.material as THREE.LineBasicMaterial).dispose();
			sourceMarker.geometry.dispose();
			(sourceMarker.material as THREE.PointsMaterial).dispose();
		}
	});
}
