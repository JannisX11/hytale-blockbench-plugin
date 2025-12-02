import { track } from "./cleanup";
import { FORMAT_IDS } from "./formats";
import { updateUVSize } from "./texture";

export function setupAttachments() {

	let import_as_attachment = new Action('import_as_hytale_attachment', {
		name: 'Import Attachment',
		icon: 'fa-hat-cowboy',
		click() {
			Filesystem.importFile({
				extensions: ['blockymodel'],
				type: 'Blockymodel',
				multiple: true,
				startpath: Project.export_path.replace(/[\\\/]\w+.\w+$/, '') + osfs + 'Attachments'
			}, (files) => {
				for (let file of files) {
					let json = autoParseJSON(file.content as string);
					let attachment_name = file.name.replace(/\.\w+$/, '');
					let content: any = Codecs.blockymodel.parse(json, file.path, {attachment: attachment_name});
					let name = file.name.split('.')[0]

					let new_groups = content.new_groups as Group[];
					let root_groups = new_groups.filter(group => !new_groups.includes(group.parent as Group));

					let collection = new Collection({
						name,
						children: root_groups.map(g => g.uuid),
						export_codec: 'blockymodel',
						visibility: true,
					}).add();
					collection.export_path = file.path;

					let new_textures = content.new_textures as Texture[];
					if (new_textures.length) {
						let texture_group = new TextureGroup({name});
						texture_group.add();
						// @ts-expect-error
						new_textures.forEach(tex => tex.group = texture_group.uuid);

						// Update UV size
						for (let texture of new_textures) {
							updateUVSize(texture);
						}

						let texture = new_textures.find(t => t.name.startsWith(attachment_name)) ?? new_textures[0];

						// @ts-expect-error
						collection.texture = texture.uuid;
						Canvas.updateAllFaces();
					}
				}
			})
		}
	});
	track(import_as_attachment);
	let toolbar = Panels.collections.toolbars[0];
	toolbar.add(import_as_attachment);


	let texture_property = new Property(Collection, 'string', 'texture', {
		condition: {formats: FORMAT_IDS}
	});
	track(texture_property);

	function getCollection(cube: Cube) {
		return Collection.all.find(c => c.contains(cube));
	}

	let originalGetTexture = CubeFace.prototype.getTexture;
	CubeFace.prototype.getTexture = function(...args) {
		if (Format.id == 'hytale_character') {
			let collection = getCollection(this.cube);
			if (collection && "texture" in collection && collection.texture) {
				let texture = Texture.all.find(t => t.uuid == collection.texture);
				if (texture) return texture;
			}
		}
		return originalGetTexture.call(this, ...args);
	}
	track({
		delete() {
			CubeFace.prototype.getTexture = originalGetTexture;
		}
	});

	let assign_texture: CustomMenuItem = {
		id: 'set_texture',
		name: 'menu.cube.texture',
		icon: 'collections',
		condition: {formats: FORMAT_IDS},
		children(context: Collection & {texture: string}) {
			function applyTexture(texture_value: string, undo_message: string) {
				Undo.initEdit({collections: Collection.selected});
				for (let collection of Collection.selected) {
					// @ts-expect-error
					collection.texture = texture_value;
				}
				Undo.finishEdit(undo_message);
				Canvas.updateAllFaces();
			}
			let arr: CustomMenuItem[] = [
				{icon: 'crop_square', name: Format.single_texture_default ? 'menu.cube.texture.default' : 'menu.cube.texture.blank', click(group) {
					applyTexture('', 'Unassign texture from collection');
				}}
			]
			Texture.all.forEach(t => {
				arr.push({
					name: t.name,
					// @ts-ignore
					icon: t.img,
					marked: t.uuid == context.texture,
					click() {
						applyTexture(t.uuid, 'Apply texture to collection');
					}
				})
			})
			return arr;
		}
	};
	Collection.menu.addAction(assign_texture);

}