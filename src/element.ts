//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";
import { cubeIsQuad } from "./util";

// TODO(Blockbench): Resizing a stretched cube causes it to drift. The gizmo's move_value
// is in rendered space (stretch applied) but resize() applies it directly to from/to.
// Fix: divide val by stretch, then shift from/to to restore the fixed edge position.
function setupStretchedCubeResizeFix() {
	const originalResize = Cube.prototype.resize;

	Cube.prototype.resize = function(
		val: number | ((n: number) => number),
		axis: number,
		negative?: boolean,
		allow_negative?: boolean,
		bidirectional?: boolean
	) {
		if (!FORMAT_IDS.includes(Format?.id) || !this.isStretched() || this.stretch[axis] === 1) {
			return originalResize.call(this, val, axis, negative, allow_negative, bidirectional);
		}

		const stretch = this.stretch[axis];

		// Save fixed edge position: center (+-) halfSize * stretch
		// (see adjustFromAndToForInflateAndStretch in cube.js)
		let fixedEdgePos: number | null = null;
		if (!bidirectional) {
			const center = (this.from[axis] + this.to[axis]) / 2;
			const halfSize = Math.abs(this.to[axis] - this.from[axis]) / 2;
			fixedEdgePos = negative
				? center + halfSize * stretch
				: center - halfSize * stretch;
		}

		// Convert gizmo's rendered distance to from/to distance
		const adjustedVal = (typeof val === 'function')
			? (n: number) => (val as (n: number) => number)(n * stretch) / stretch
			: val / stretch;

		originalResize.call(this, adjustedVal, axis, negative, allow_negative, bidirectional);

		// Counter resize() moving center
		if (fixedEdgePos !== null) {
			const newCenter = (this.from[axis] + this.to[axis]) / 2;
			const newHalfSize = Math.abs(this.to[axis] - this.from[axis]) / 2;
			const currentEdgePos = negative
				? newCenter + newHalfSize * stretch
				: newCenter - newHalfSize * stretch;

			const drift = fixedEdgePos - currentEdgePos;
			this.from[axis] += drift;
			this.to[axis] += drift;

			this.preview_controller.updateGeometry(this);
		}

		return this;
	};

	track({
		delete() {
			Cube.prototype.resize = originalResize;
		}
	});
}

export function setupElements() {
	// setupStretchedCubeResizeFix();
	let property_shading_mode = new Property(Cube, 'enum', 'shading_mode', {
		default: 'flat',
		values: ['flat', 'standard', 'fullbright', 'reflective'],
		condition: {formats: FORMAT_IDS},
		inputs: {
			element_panel: {
				input: {label: 'Shading Mode', type: 'select', options: {
					flat: 'Flat',
					standard: 'Standard',
					fullbright: 'Always Lit',
					reflective: 'Reflective'
				}},
				onChange() {
				}
			}
		}
	});
	track(property_shading_mode);
	let property_double_sided = new Property(Cube, 'boolean', 'double_sided', {
		condition: {formats: FORMAT_IDS},
		inputs: {
			element_panel: {
				input: {label: 'Double Sided', type: 'checkbox'},
				onChange() {
					Canvas.updateView({elements: Cube.all, element_aspects: {transform: true}})
				}
			}
		}
	});
	track(property_double_sided);

	let is_piece_property = new Property(Group, 'boolean', 'is_piece', {
		condition: {formats: FORMAT_IDS},
		inputs: {
			element_panel: {
				input: {
					label: 'Attachment Piece',
					type: 'checkbox',
					description: 'When checked, the node will be attached to a node of the same name when displayed as an attachment in-game.'
				}
			}
		}
	});
	track(is_piece_property);

	let add_quad_action = new Action('hytale_add_quad', {
		name: 'Add Quad',
		icon: 'highlighter_size_5',
		category: 'edit',
		condition: {formats: FORMAT_IDS, modes: ['edit']},
		click() {
			let color = Math.floor(Math.random()*markerColors.length);
			let initial = 'pos_z';

			function runEdit(amended: boolean, normal: string) {
				Undo.initEdit({outliner: true, elements: [], selection: true}, amended);
				let base_quad = new Cube({
					autouv: (settings.autouv.value ? 1 : 0),
					// @ts-ignore
					double_sided: true,
					box_uv: false,
					color
				}).init()
				base_quad.mapAutoUV();
				let group = getCurrentGroup();
				if (group) {
					base_quad.addTo(group)
					if (settings.inherit_parent_color.value) base_quad.color = group.color;
				}

				let texture = (Texture.all.length && Format.single_texture)
					? Texture.getDefault().uuid
					: false;
				for (let face in base_quad.faces) {
					base_quad.faces[face].texture = null;
				}

				let size = [8, 8, 8];
				let positive = normal.startsWith('pos');
				switch (normal[4]) {
					case 'x': {
						base_quad.faces.west.texture = positive ? null : texture;
						base_quad.faces.east.texture = positive ? texture : null;
						size[0] = 0;
						break;
					}
					case 'y': {
						base_quad.faces.down.texture = positive ? null : texture;
						base_quad.faces.up.texture = positive ? texture : null;
						size[1] = 0;
						break;
					}
					case 'z': {
						base_quad.faces.north.texture = positive ? null : texture;
						base_quad.faces.south.texture = positive ? texture : null;
						size[2] = 0;
						break;
					}
				}
				base_quad.extend({
					from: [-size[0]/2, 0, -size[2]/2],
					to: [size[0]/2, size[1], size[2]/2],
				});

				let fkey = Object.keys(base_quad.faces).find(fkey => base_quad.faces[fkey].texture != null);
				UVEditor.getSelectedFaces(base_quad, true).replace([fkey]);

				base_quad.select();
				Canvas.updateView({elements: [base_quad], element_aspects: {transform: true, geometry: true, faces: true}})
				Undo.finishEdit('Add quad', {outliner: true, elements: selected, selection: true});

				Vue.nextTick(function() {
					if (settings.create_rename.value) {
						base_quad.rename()
					}
				})
			}
			runEdit(false, initial);
			
			Undo.amendEdit({
				normal: {
					type: 'inline_select', value: initial, label: 'Normal',
					options: {
						'pos_x': '+X',
						'neg_x': '-X',
						'pos_y': '+Y',
						'neg_y': '-Y',
						'pos_z': '+Z',
						'neg_z': '-Z',
					}
				},
			}, form => {
				runEdit(true, form.normal);
			})
		}
	});
	track(add_quad_action);
	let add_element_menu = ((BarItems.add_element as Action).side_menu as Menu);
	add_element_menu.addAction(add_quad_action);

	// Add Bone with Cube action - uses native Add Group then adds cube inside
	let add_bone_action = new Action('hytale_add_bone_with_cube', {
		name: 'Add Bone with Cube',
		icon: 'fa-cubes',
		category: 'edit',
		condition: {formats: FORMAT_IDS, modes: ['edit']},
		click() {
			// Use native Add Group action - handles all parenting/positioning correctly
			let addGroupAction = BarItems.add_group as Action;
			addGroupAction.trigger();

			// Get the newly created group (should be selected)
			let group = Group.selected[0];
			if (!group) return;

			// Now add a cube inside the group
			Undo.initEdit({outliner: true, elements: [], selection: true}, true); // amend the previous edit

			let cube = new Cube({
				name: group.name,
				autouv: (settings.autouv.value ? 1 : 0),
				box_uv: false,
				rotation: [0, 0, 0],
				origin: group.origin.slice() as ArrayVector3,
				from: [group.origin[0] - 4, group.origin[1], group.origin[2] - 4],
				to: [group.origin[0] + 4, group.origin[1] + 8, group.origin[2] + 4],
				color: group.color
			}).init().addTo(group);

			cube.mapAutoUV();

			// Keep group selected
			group.select();

			Canvas.updateView({elements: [cube], element_aspects: {transform: true, geometry: true, faces: true}});
			Undo.finishEdit('Add bone with cube', {outliner: true, elements: selected, selection: true});
		}
	});
	track(add_bone_action);
	add_element_menu.addAction(add_bone_action);
	
	// Box UV on quads
	let set_uv_mode_original = Cube.prototype.setUVMode;
	Cube.prototype.setUVMode = function (box_uv, ...args) {
		if (isHytaleFormat()) {
			if (cubeIsQuad(this) && box_uv) return;
		}
		return set_uv_mode_original.call(this, box_uv, ...args);
	}
	track({
		delete() {
			Cube.prototype.setUVMode = set_uv_mode_original;
		}
	});

	// Inflate
	let inflate_condition_original = BarItems.slider_inflate.condition;
	BarItems.slider_inflate.condition = () => {
		if (isHytaleFormat()) return false;
		return Condition(inflate_condition_original);
	}
	track({
		delete() {
			BarItems.slider_inflate.condition = inflate_condition_original;
		}
	});

	// UV workflow and inflate fallback
	Blockbench.on('finish_edit', (arg: {aspects: UndoAspects}) => {
        if (!FORMAT_IDS.includes(Format.id)) return;
		if (arg.aspects?.elements) {
			let uv_changes = false;
			for (let element of arg.aspects.elements) {
				if (element instanceof Cube == false) continue;

				if (!element.autouv) {
					element.autouv = 1;
					element.mapAutoUV();
					element.preview_controller.updateUV(element);
					uv_changes = true;
				}
				if (element.inflate) {
					// Set inflate to 0 in case a value is set for unknown reasons
					element.inflate = 0;
					element.preview_controller.updateGeometry(element);
					TickUpdates.selection = true;
				}
			}
			if (uv_changes) {
				UVEditor.vue.$forceUpdate();
			}
		}
	});
};