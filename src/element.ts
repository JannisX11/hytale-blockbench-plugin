import { track } from "./cleanup";
import { Config } from "./config";

export function setupElements() {
	let property_shading_mode = new Property(Cube, 'enum', 'shading_mode', {
		default: 'flat',
		values: ['flat', 'standard', 'fullbright', 'reflective'],
		condition: () => Format.id == 'hytale_model',
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
		condition: () => Format.id == 'hytale_model',
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

	let add_quad_action = new Action('hytale_add_quad', {
		name: 'Add Quad',
		icon: 'highlighter_size_5',
		category: 'edit',
		condition: {formats: [Config.format_id], modes: ['edit']},
		click() {
			let color = Math.floor(Math.random()*markerColors.length);
			let initial = 'pos_z';

			function runEdit(amended: boolean, normal: string) {
				Undo.initEdit({outliner: true, elements: [], selection: true}, amended);
				let base_quad = new Cube({
					autouv: (settings.autouv.value ? 1 : 0),
					color
				}).init()
				if (!base_quad.box_uv) base_quad.mapAutoUV()
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
};