import { track } from "./cleanup";
import { FORMAT_IDS } from "./formats";
import { discoverTexturePaths } from "./blockymodel";
import {
	AttachmentCollection,
	setupAttachmentTextures,
	getAttachmentMaterial,
	clearAttachmentMaterial
} from "./attachment_texture";

export { AttachmentCollection } from "./attachment_texture";
export let reload_all_attachments: Action;

/**
 * Attachments are external blockymodel files imported as Collections.
 * They maintain their own texture system separate from the main model's textures,
 * allowing accessories like hats or weapons to have independent texture variants.
 */
export function setupAttachments() {
	setupAttachmentTextures();

	let import_as_attachment = new Action('import_as_hytale_attachment', {
		name: 'Import Attachment',
		icon: 'fa-hat-cowboy',
		condition: {formats: FORMAT_IDS},
		click() {
			Filesystem.importFile({
				extensions: ['blockymodel'],
				type: 'Blockymodel',
				multiple: true,
				startpath: Project.export_path.replace(/[\\\/]\w+.\w+$/, '') + osfs + 'Attachments'
			}, (files) => {
				let fs = requireNativeModule('fs');
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
					}).add() as AttachmentCollection;
					collection.export_path = file.path;

					// Parser creates Texture objects we don't need - attachments use their own texture system
					let createdTextures = content.new_textures as Texture[];
					for (let tex of createdTextures) {
						tex.remove();
					}

					// Auto-discover textures: prioritize ModelName_Textures/ folder, fall back to loose files
					let dirname = PathModule.dirname(file.path);
					let texturePaths = discoverTexturePaths(dirname, attachment_name);

					if (texturePaths.length > 0) {
						let texturesFolderPath = PathModule.join(dirname, `${attachment_name}_Textures`);
						let hasTexturesFolder = fs.existsSync(texturesFolderPath) && fs.statSync(texturesFolderPath).isDirectory();

						if (hasTexturesFolder) {
							collection.texture_path = texturesFolderPath;
							let folderTextures = texturePaths.filter(p => p.startsWith(texturesFolderPath));
							if (folderTextures.length > 0) {
								collection.selected_texture = PathModule.basename(folderTextures[0]);
							}
						} else if (texturePaths.length === 1) {
							collection.texture_path = texturePaths[0];
							collection.selected_texture = '';
						} else {
							collection.texture_path = dirname;
							collection.selected_texture = PathModule.basename(texturePaths[0]);
						}

						getAttachmentMaterial(collection);
					}
					Canvas.updateAllFaces();
				}
			})
		}
	});
	track(import_as_attachment);
	let toolbar = Panels.collections.toolbars[0];
	toolbar.add(import_as_attachment);

	/**
	 * Re-imports an attachment from disk, preserving texture settings.
	 * Used when the source blockymodel file has been modified externally.
	 */
	function reloadAttachment(collection: Collection) {
		for (let child of collection.getChildren()) {
			child.remove();
		}

		clearAttachmentMaterial(collection.uuid);

		Filesystem.readFile([collection.export_path], {}, ([file]) => {
			let json = autoParseJSON(file.content as string);
			let content: any = Codecs.blockymodel.parse(json, file.path, {attachment: collection.name});

			let new_groups = content.new_groups as Group[];
			let root_groups = new_groups.filter(group => !new_groups.includes(group.parent as Group));

			let createdTextures = content.new_textures as Texture[];
			for (let tex of createdTextures) {
				tex.remove();
			}

			collection.extend({
				children: root_groups.map(g => g.uuid),
			}).add();

			let attCollection = collection as AttachmentCollection;
			if (attCollection.texture_path) {
				getAttachmentMaterial(attCollection);
			}

			Canvas.updateAllFaces();
		})
	}

	let reload_attachment_action = new Action('reload_hytale_attachment', {
		name: 'Reload Attachment',
		icon: 'refresh',
		condition: () => Collection.selected.length && Modes.edit,
		click() {
			for (let collection of Collection.selected) {
				reloadAttachment(collection);
			}
		}
	})
	Collection.menu.addAction(reload_attachment_action, 10);
	track(reload_attachment_action);

	let remove_attachment_action = new Action('remove_hytale_attachment', {
		name: 'Remove Attachment',
		icon: 'remove_selection',
		condition: () => Collection.selected.length && Modes.edit,
		click() {
			for (let collection of [...Collection.selected]) {
				for (let child of collection.getChildren()) {
					child.remove();
				}
				clearAttachmentMaterial(collection.uuid);
				Collection.all.remove(collection);
			}
		}
	})
	Collection.menu.addAction(remove_attachment_action, 11);
	track(remove_attachment_action);

	reload_all_attachments = new Action('reload_all_hytale_attachments', {
		name: 'Reload All Attachments',
		icon: 'sync',
		condition: {formats: FORMAT_IDS},
		click() {
			for (let collection of Collection.all.filter(c => c.export_path)) {
				reloadAttachment(collection);
			}
		}
	});
	track(reload_all_attachments);
	toolbar.add(reload_all_attachments);
}
