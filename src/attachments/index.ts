//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { setupAttachmentTextures } from "./texture";
import { setupDelete } from "./delete";
import { setupImport } from "./import";
import { setupCreateAttachment } from "./create";
import { setupAddToAttachment } from "./add_to";
import { setupAttachmentValidation } from "./validation";

export { AttachmentCollection } from "./texture";
export { reload_all_attachments } from "./import";

export function setupAttachments() {
	setupAttachmentTextures();
	setupDelete();
	setupImport();
	setupCreateAttachment();
	setupAddToAttachment();
	setupAttachmentValidation();
}
