//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";
import { discoverTexturePaths } from "../blockymodel";
import { AttachmentCollection, processAttachmentTextures } from "./texture";

export let reload_all_attachments: Action;

export function setupImport() {
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

					let texturesToProcess: Texture[] = content.new_textures as Texture[];

					if (texturesToProcess.length === 0) {
						let dirname = PathModule.dirname(file.path);
						let texturePaths = discoverTexturePaths(dirname, attachment_name);
						for (let texPath of texturePaths) {
							let tex = new Texture().fromPath(texPath).add(false);
							texturesToProcess.push(tex);
						}
					}

					let textureUuid = processAttachmentTextures(attachment_name, texturesToProcess);
					if (textureUuid) {
						collection.texture = textureUuid;
					}

					Canvas.updateAllFaces();
				}
			})
		}
	});
	track(import_as_attachment);
	let toolbar = Panels.collections.toolbars[0];
	toolbar.add(import_as_attachment);
	MenuBar.menus.file.addAction(import_as_attachment, 'import');

	function reloadAttachment(collection: Collection) {
		for (let child of collection.getChildren()) {
			child.remove();
		}

		Filesystem.readFile([collection.export_path], {}, ([file]) => {
			let json = autoParseJSON(file.content as string);
			let content: any = Codecs.blockymodel.parse(json, file.path, {attachment: collection.name});

			let new_groups = content.new_groups as Group[];
			let root_groups = new_groups.filter(group => !new_groups.includes(group.parent as Group));

			collection.extend({
				children: root_groups.map(g => g.uuid),
			}).add();

			Canvas.updateAllFaces();
		})
	}

	let reload_attachment_action = new Action('reload_hytale_attachment', {
		name: 'Reload Attachment',
		icon: 'refresh',
		condition: () => Collection.selected.length && Modes.edit && isHytaleFormat(),
		click() {
			for (let collection of Collection.selected) {
				reloadAttachment(collection);
			}
		}
	})
	Collection.menu.addAction(reload_attachment_action, 10);
	track(reload_attachment_action);

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
