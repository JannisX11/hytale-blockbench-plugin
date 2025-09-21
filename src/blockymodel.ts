type BlockymodelJSON = {
	nodes: BlockymodelNode[]
	lod?: 'auto'
}
type BlockymodelNode = {
	id: string
	name: string
	position: IVector
	orientation: IQuaternion
	shape?: {
		offset: IVector
		stretch: IVector
		textureLayout: Record<string, IUvFace>
		type: 'box' | 'none' | 'quad'
		settings: {
			size: IVector
		}
		unwrapMode: "custom"
		visible: boolean
		doubleSided: boolean
		shadingMode: 'flat' | 'standard' | 'fullbright' | 'reflective'
	}
	children?: BlockymodelNode[]
}
type IUvFace = {
	offset: {x: number, y: number}
	mirror: {x: boolean, y: boolean}
	angle: 0 | 90 | 180 | 270
}
type IVector = {x: number, y: number, z: number}
type IQuaternion = {x: number, y: number, z: number}

export function setupBlockymodelCodec(): Deletable[] {
	let codec = new Codec('blockymodel', {
		name: 'Hytale Blockymodel',
		extension: 'blockymodel',
		remember: true,
		support_partial_export: true,
		load_filter: {
			type: 'json',
			extensions: ['blockymodel']
		},
		compile(options): string | BlockymodelJSON {
			let model: BlockymodelJSON = {
				nodes: [],
				lod: 'auto'
			}
			if (options.raw) {
				return model;
			} else {
				return autoStringify(model);
			}
		},
		parse(model: BlockymodelJSON, path: string, options?) {

		}
	})
	let export_action = new Action('export_optifine_part', {
		name: 'Export OptiFine Part',
		description: 'Export a single part for an OptiFine model',
		icon: 'icon-optifine_file',
		category: 'file',
		condition: () => Format.id == 'hytale_model',
		click: function () {
			codec.export()
		}
	})
	return [codec, export_action];
}