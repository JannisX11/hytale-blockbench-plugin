//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { isHytaleFormat } from "../formats";
import { setupAttachmentTextures } from "./texture";
import { setupDelete } from "./delete";
import { setupImport } from "./import";
import { setupCreateAttachment } from "./create";
import { setupAddToAttachment } from "./add_to";
import { setupAttachmentValidation } from "./validation";
import { setupAttachmentWatcher } from "./watcher";
import { setupDetachFromAttachment } from "./detach";
import { setupCollectionColor } from "./collection_color";
import { setupCollectionFolders } from "./collection_folder";
import { setupUnload } from "./unload";

export { AttachmentCollection } from "./texture";
export { reload_all_attachments, reloadAttachment } from "./import";

function setupCollectionDoubleClick() {
	let collectionsNode = Panels.collections?.node;
	if (!collectionsNode) return;

	function onDblClick(e: MouseEvent) {
		if (!isHytaleFormat()) return;
		if ((e.target as HTMLElement).closest('.in_list_button')) return;

		let target = e.target as HTMLElement;
		while (target && !target.classList?.contains('collection')) {
			target = target.parentElement as HTMLElement;
		}
		if (!target) return;

		let uuid = target.getAttribute('uuid');
		let collection = Collection.all.find(c => c.uuid === uuid);
		if (!collection?.export_path) return;

		let openEntry = Collection.menu.structure.find((entry: any) => entry?.id === 'open');
		if (openEntry && Condition(openEntry.condition, collection)) {
			e.stopPropagation();
			openEntry.click(collection);
		}
	}

	collectionsNode.addEventListener('dblclick', onDblClick, true);
	track({
		delete() {
			collectionsNode.removeEventListener('dblclick', onDblClick, true);
		}
	});
}

function setupUnsavedIndicator() {
	let style = Blockbench.addCSS(`
		#collections_list .collection .in_list_button[title]:not(.unclickable):not(.hytale_piece_error_icon) {
			color: var(--color-warning);
		}
	`);
	track({ delete() { style.delete(); } });
}

function setupOutlinerStyles() {
	let style = Blockbench.addCSS(`
		.outliner_object.hytale_attachment_piece > .icon.material-icons:not(.outliner_toggle)::before {
			content: "attachment";
			display: block;
			margin-bottom: 10px;
			margin-right: 10px;
		}
		.outliner_object.hytale_attachment_piece > input[type=text] {
			text-decoration: underline;
		}
	`);
	let outlinerHook = Blockbench.on('get_outliner_node_classes', ({node, classes}: any) => {
		if (isHytaleFormat() && node.is_piece) classes.push('hytale_attachment_piece');
	});
	track(outlinerHook, style);
}

export function setupAttachments() {
	setupAttachmentTextures();
	setupDelete();
	setupImport();
	setupCreateAttachment();
	setupAddToAttachment();
	setupDetachFromAttachment();
	setupAttachmentValidation();
	setupAttachmentWatcher();
	setupCollectionDoubleClick();
	setupUnsavedIndicator();
	setupUnload();
	setupCollectionFolders();
	setupCollectionColor();
	setupOutlinerStyles();
}
