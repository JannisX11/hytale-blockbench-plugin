import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";

/**
 * Outliner filtering system for hiding attachment elements from the outliner panel
 * while keeping them visible in the viewport.
 */

const HIDDEN_CLASS = 'hytale_attachment_hidden';
let attachmentsHidden = false;

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
	// Inject CSS for hiding outliner nodes
	let style = document.createElement('style');
	style.id = 'hytale-outliner-filter-styles';
	style.textContent = `
		.outliner_node.${HIDDEN_CLASS} {
			display: none !important;
		}
	`;
	document.head.appendChild(style);

	// Initialize state from StateMemory
	StateMemory.init('hytale_attachments_hidden', 'boolean');
	attachmentsHidden = StateMemory.get('hytale_attachments_hidden') ?? false;

	// Create toggle for outliner toolbar
	let toggle = new Toggle('toggle_attachments_in_outliner', {
		name: 'Toggle Attachments',
		description: 'Show or hide attachments in the outliner',
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

	// Refresh visibility when outliner updates
	let hookFinishedEdit = Blockbench.on('finished_edit', () => {
		if (attachmentsHidden) {
			setTimeout(applyOutlinerVisibility, 10);
		}
	});

	let hookSelectMode = Blockbench.on('select_mode', () => {
		if (attachmentsHidden) {
			setTimeout(applyOutlinerVisibility, 50);
		}
	});

	let hookSelection = Blockbench.on('update_selection', () => {
		if (attachmentsHidden) {
			setTimeout(applyOutlinerVisibility, 10);
		}
	});

	// Initial application
	if (attachmentsHidden) {
		setTimeout(applyOutlinerVisibility, 100);
	}

	track(toggle, hookFinishedEdit, hookSelectMode, hookSelection, {
		delete() {
			style.remove();
			Panels.outliner?.node?.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => {
				el.classList.remove(HIDDEN_CLASS);
			});
		}
	});
}
