export function setupElements(): Deletable[] {
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
	return [
		property_double_sided,
		property_shading_mode,
	]
};