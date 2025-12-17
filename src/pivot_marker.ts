declare global {
	const gizmo_colors: Record<string, THREE.Color>
}

export const ThickLineAxisHelper = class ThickLineAxisHelper extends THREE.LineSegments {
	constructor( size: number = 1 ) {

		let a = 0.04, b = 0.025;

		let vertices = [
			0, a, 0,	size, a, 0,
			0, 0, b,	size, 0, b,
			0, 0, -b,	size, 0, -b,

			0, 0, a,	0, size, a,
			b, 0, 0,	b, size, 0,
			-b, 0, 0,	-b, size, 0,

			a, 0, 0,	a, 0, size,
			0, b, 0,	0, b,  size,
			0, -b, 0,	0, -b, size,
		];

		let geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );
		let material = new THREE.LineBasicMaterial( { vertexColors: true } );

		super(geometry, material);
		this.updateColors();
        
        material.transparent = true;
        material.depthTest = false;
        this.renderOrder = 800;
	}
	updateColors() {
		let colors = [
			...gizmo_colors.r.toArray(), ...gizmo_colors.r.toArray(),
			...gizmo_colors.r.toArray(), ...gizmo_colors.r.toArray(),
			...gizmo_colors.r.toArray(), ...gizmo_colors.r.toArray(),

			...gizmo_colors.g.toArray(), ...gizmo_colors.g.toArray(),
			...gizmo_colors.g.toArray(), ...gizmo_colors.g.toArray(),
			...gizmo_colors.g.toArray(), ...gizmo_colors.g.toArray(),

			...gizmo_colors.b.toArray(), ...gizmo_colors.b.toArray(),
			...gizmo_colors.b.toArray(), ...gizmo_colors.b.toArray(),
			...gizmo_colors.b.toArray(), ...gizmo_colors.b.toArray(),
		]
		this.geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );
	}
}
ThickLineAxisHelper.prototype.constructor = ThickLineAxisHelper;


export class CustomPivotMarker {
	original_helpers: THREE.LineSegments[];

	constructor() {
		this.original_helpers = Canvas.pivot_marker.children.slice() as THREE.LineSegments[];
		let [helper1, helper2] = this.original_helpers;
		let helper1_new = new ThickLineAxisHelper(1);
		let helper2_new = new ThickLineAxisHelper(1);
		helper1_new.rotation.copy(helper1.rotation);
		helper2_new.rotation.copy(helper2.rotation);

		Canvas.pivot_marker.children.empty();
		Canvas.pivot_marker.add(helper1_new, helper2_new);
	}

	delete() {
		Canvas.pivot_marker.children.empty();
		Canvas.pivot_marker.add(...this.original_helpers);
	}
}

/**
 * Shows a dot at the pivot position of the currently relevant group.
 * When a group is selected, shows at its pivot. When an element is selected,
 * shows at the parent group's pivot.
 */
export class GroupPivotIndicator {
	dot: THREE.Mesh;
	listener: Deletable;

	constructor() {
		let geometry = new THREE.SphereGeometry(0.65, 12, 12);
		let material = new THREE.MeshBasicMaterial({
			color: this.getAccentColor(),
			transparent: true,
			opacity: 0.9,
			depthTest: false
		});
		this.dot = new THREE.Mesh(geometry, material);
		this.dot.renderOrder = 900;
		this.dot.visible = false;

		Canvas.scene.add(this.dot);

		this.listener = Blockbench.on('update_selection', () => this.update());
		this.update();
	}

	getAccentColor(): THREE.Color {
		let cssColor = getComputedStyle(document.body).getPropertyValue('--color-accent').trim();
		return new THREE.Color(cssColor || '#3e90ff');
	}

	update() {
		let group = this.getRelevantGroup();
		if (!group) {
			this.dot.visible = false;
			return;
		}

		// Update color in case accent changed
		(this.dot.material as THREE.MeshBasicMaterial).color.copy(this.getAccentColor());

		// Get world position of group pivot
		let mesh = group.mesh;
		if (mesh) {
			let worldPos = new THREE.Vector3();
			mesh.getWorldPosition(worldPos);
			this.dot.position.copy(worldPos);
			this.dot.visible = true;
		} else {
			this.dot.visible = false;
		}
	}

	getRelevantGroup(): Group | null {
		let sel = Outliner.selected[0];
		if (!sel) return null;

		if (sel instanceof Group) {
			return sel;
		}
		if (sel.parent instanceof Group) {
			return sel.parent;
		}
		return null;
	}

	delete() {
		Canvas.scene.remove(this.dot);
		this.dot.geometry.dispose();
		(this.dot.material as THREE.MeshBasicMaterial).dispose();
		this.listener.delete();
	}
}
