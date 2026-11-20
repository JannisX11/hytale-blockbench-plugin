//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";
import { discoverTexturePaths } from "../blockymodel";
import { AttachmentCollection, processAttachmentTextures } from "./texture";
import { pushReloadUndo, watchCollection } from "./watcher";
import { assignCollectionScope, isUnloaded } from "./unload";
import { reparseAttachment, transferNodeUuids } from "./rebuild";
import { getUniqueAttachmentName } from "./rename";
import { detectHeld, setHeld } from "./held";

export let reload_all_attachments: Action;

type FolderCollection = Collection & { texture: string, folder: string };

function importFiles(files: Filesystem.FileResult[], folderUuid?: string) {
	for (let file of files) {
		if (Collection.all.some(c => c.export_path === file.path)) {
			Blockbench.showQuickMessage(`Attachment "${file.name}" is already imported`, 2000);
			continue;
		}
		let json = autoParseJSON(file.content as string);
		let attachment_name = file.name.replace(/\.\w+$/, '');
		let name = getUniqueAttachmentName(attachment_name, file.path);
		let held = detectHeld(json, file.path);
		let content: any = Codecs.blockymodel.parse(json, file.path, {attachment: name, held});

		let new_groups = content.new_groups as Group[];
		let root_groups = new_groups.filter(group => !new_groups.includes(group.parent as Group));

		let collection = new Collection({
			name,
			children: root_groups.map(g => g.uuid),
			export_codec: 'blockymodel',
			visibility: true,
		}).add() as AttachmentCollection;
		collection.export_path = file.path;
		setHeld(collection, held);
		assignCollectionScope(collection);

		if (folderUuid) (collection as FolderCollection).folder = folderUuid;

		let texturesToProcess: Texture[] = content.new_textures as Texture[];

		if (texturesToProcess.length === 0) {
			let dirname = PathModule.dirname(file.path);
			let texturePaths = discoverTexturePaths(dirname, attachment_name);
			for (let texPath of texturePaths) {
				let tex = new Texture().fromPath(texPath).add(false);
				texturesToProcess.push(tex);
			}
		}

		let textureUuid = processAttachmentTextures(name, texturesToProcess, attachment_name);
		if (textureUuid) {
			collection.texture = textureUuid;
		}

		Canvas.updateAllFaces();
		watchCollection(collection);
	}
}

export function importAttachmentToFolder(folderUuid: string) {
	Filesystem.importFile({
		extensions: ['blockymodel'],
		type: 'Blockymodel',
		multiple: true,
		startpath: Project.export_path.replace(/[\\\/]\w+.\w+$/, '') + osfs + 'Attachments'
	}, (files) => importFiles(files, folderUuid));
}

export function reloadAttachment(collection: Collection) {
	if (isUnloaded(collection)) return;
	let path = collection.export_path;
	if (!path) return;

	let fs = requireNativeModule('fs');
	if (!fs.existsSync(path)) return;

	let beforeJson = Codecs.blockymodel.compile({attachment: collection, raw: true, uuids: true});

	let fileJson = autoParseJSON(fs.readFileSync(path, 'utf-8'));
	transferNodeUuids(beforeJson, fileJson);
	// Undo entries can outlive this Collection object, so look it up again
	let uuid = collection.uuid;
	let restore = (json: any) => {
		let target = Collection.all.find(c => c.uuid === uuid);
		if (target) reparseAttachment(target, undefined, json);
	};
	restore(fileJson);
	// New nodes got fresh uuids, so redo must recreate them with the same ones
	let afterJson = Codecs.blockymodel.compile({attachment: collection, raw: true, uuids: true});

	pushReloadUndo(beforeJson, afterJson, 'Reload attachment', restore);

	Canvas.updateAllFaces();
}

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
			}, (files) => importFiles(files))
		}
	});
	track(import_as_attachment);
	let toolbar = Panels.collections.toolbars[0];
	toolbar.add(import_as_attachment);
	MenuBar.menus.file.addAction(import_as_attachment, 'import');

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
			for (let collection of Collection.all.filter(c => c.export_path && !isUnloaded(c))) {
				reloadAttachment(collection);
			}
		}
	});
	track(reload_all_attachments);
	toolbar.add(reload_all_attachments);
}
