//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { setupAttachmentTextures } from "./texture";
import { setupDelete } from "./delete";
import { setupImport } from "./import";
import { setupCreateAttachment } from "./create";

export { AttachmentCollection } from "./texture";
export { reload_all_attachments } from "./import";

export function setupAttachments() {
	setupAttachmentTextures();
	setupDelete();
	setupImport();
	setupCreateAttachment();
}
