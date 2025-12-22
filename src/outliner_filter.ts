//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";

/**
 * Outliner filtering system for hiding attachment elements from the outliner panel
 * while keeping them visible in the viewport.
 */

const HIDDEN_CLASS = 'hytale_attachment_hidden';
let attachmentsHidden = false;
let visibilityUpdatePending = false;

function scheduleVisibilityUpdate() {
	if (!attachmentsHidden || visibilityUpdatePending) return;
	visibilityUpdatePending = true;
	requestAnimationFrame(() => {
		visibilityUpdatePending = false;
		applyOutlinerVisibility();
	});
}

/**
 * Get all UUIDs of elements belonging to any collection (attachments)
 */
function getAttachmentUUIDs(): string[] {
	let uuids: string[] = [];

	if (!Collection.all?.length) return uuids;

	for (let collection of Collection.all) {
		for (let child of collection.getChildren()) {
			uuids.push(child.uuid);
			if ('children' in child && Array.isArray(child.children)) {
				collectChildUUIDs(child as Group, uuids);
			}
		}
	}

	return uuids;
}

function collectChildUUIDs(parent: Group, uuids: string[]) {
	for (let child of parent.children) {
		if (child instanceof OutlinerNode) {
			uuids.push(child.uuid);
			if ('children' in child && Array.isArray((child as Group).children)) {
				collectChildUUIDs(child as Group, uuids);
			}
		}
	}
}

/**
 * Apply hidden class to all attachment elements in the outliner DOM
 * and lock/unlock them for viewport selection
 */
function applyOutlinerVisibility() {
	if (!isHytaleFormat()) return;

	const outlinerNode = Panels.outliner?.node;
	if (!outlinerNode) return;

	if (!attachmentsHidden) {
		// Unhide from outliner
		outlinerNode.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => {
			el.classList.remove(HIDDEN_CLASS);
		});
		// Unlock attachment elements
		for (let collection of Collection.all ?? []) {
			for (let child of collection.getChildren()) {
				unlockRecursive(child);
			}
		}
		return;
	}

	const uuids = getAttachmentUUIDs();

	for (let uuid of uuids) {
		// Hide from outliner
		let node = outlinerNode.querySelector(`[id="${uuid}"]`);
		if (node) {
			node.classList.add(HIDDEN_CLASS);
		}
		// Lock element to prevent viewport selection
		let element = OutlinerNode.uuids[uuid];
		if (element) {
			element.locked = true;
		}
	}
}

function unlockRecursive(node: OutlinerNode) {
	node.locked = false;
	if ('children' in node && Array.isArray((node as Group).children)) {
		for (let child of (node as Group).children) {
			if (child instanceof OutlinerNode) {
				unlockRecursive(child);
			}
		}
	}
}

/**
 * Toggle visibility of all attachments in the outliner
 */
export function toggleAttachmentsOutlinerVisibility() {
	attachmentsHidden = !attachmentsHidden;
	applyOutlinerVisibility();
	return attachmentsHidden;
}

/**
 * Set visibility of all attachments in the outliner
 */
export function setAttachmentsOutlinerVisibility(hidden: boolean) {
	attachmentsHidden = hidden;
	applyOutlinerVisibility();
}

export function setupOutlinerFilter() {
	let style = Blockbench.addCSS(`
		.outliner_node.${HIDDEN_CLASS} {
			display: none !important;
		}
		/* Lock overlay on attachment toggle when active */
		.tool[toolbar_item="toggle_attachment_editing"].enabled .fa-paperclip::after {
			content: "lock";
			font-family: "Material Icons";
			font-size: 14px;
			position: absolute;
			bottom: -1px;
			right: -3px;
			text-shadow:
				-1.5px -1.5px 0 var(--color-accent),
				1.5px -1.5px 0 var(--color-accent),
				-1.5px 1.5px 0 var(--color-accent),
				1.5px 1.5px 0 var(--color-accent),
				0px -1.5px 0 var(--color-accent),
				0px 1.5px 0 var(--color-accent),
				-1.5px 0px 0 var(--color-accent),
				1.5px 0px 0 var(--color-accent);
		}
		.tool[toolbar_item="toggle_attachment_editing"] .fa-paperclip {
			position: relative;
		}
	`);

	// Initialize state from StateMemory
	StateMemory.init('hytale_attachments_hidden', 'boolean');
	attachmentsHidden = StateMemory.get('hytale_attachments_hidden') ?? false;

	// Create toggle for outliner toolbar
	let toggle = new Toggle('toggle_attachment_editing', {
		name: 'Toggle Attachment Editing',
		description: 'Lock or unlock attachment elements for editing',
		icon: 'fa-paperclip',
		category: 'view',
		condition: {formats: FORMAT_IDS},
		default: attachmentsHidden,
		onChange(value) {
			attachmentsHidden = value;
			StateMemory.set('hytale_attachments_hidden', value);
			applyOutlinerVisibility();
		}
	});

	// Add to outliner toolbar
	let outlinerPanel = Panels.outliner;
	if (outlinerPanel && outlinerPanel.toolbars.length > 0) {
		outlinerPanel.toolbars[0].add(toggle, -1);
	}

	// Refresh visibility when outliner updates (debounced to next frame)
	let hookFinishedEdit = Blockbench.on('finished_edit', scheduleVisibilityUpdate);
	let hookSelectMode = Blockbench.on('select_mode', scheduleVisibilityUpdate);
	let hookSelection = Blockbench.on('update_selection', scheduleVisibilityUpdate);

	// Initial application
	if (attachmentsHidden) {
		setTimeout(applyOutlinerVisibility, 100);
	}

	track(toggle, hookFinishedEdit, hookSelectMode, hookSelection, style, {
		delete() {
			Panels.outliner?.node?.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => {
				el.classList.remove(HIDDEN_CLASS);
			});
		}
	});
}
