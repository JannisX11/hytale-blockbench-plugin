//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";

const SCOPE_CLASS = 'hytale_scope_override';
const COLOR_CLASS = 'hytale_collection_colored';
const COLOR_VAR = '--hytale-collection-color';
const BORDER_VAR = '--hytale-collection-border';
let colorUpdatePending = false;
let minimalColoring = false;

function scheduleColorUpdate() {
	if (colorUpdatePending) return;
	colorUpdatePending = true;
	requestAnimationFrame(() => {
		colorUpdatePending = false;
		applyCollectionColors();
	});
}

function hexToRgba(hex: string, alpha: number): string {
	let r = parseInt(hex.slice(1, 3), 16);
	let g = parseInt(hex.slice(3, 5), 16);
	let b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyCollectionColors() {
	if (!isHytaleFormat()) return;

	const outlinerPanel = Panels.outliner?.node;
	if (outlinerPanel) {
		outlinerPanel.querySelectorAll(`.${SCOPE_CLASS}`).forEach(el => {
			(el as HTMLElement).style.removeProperty(COLOR_VAR);
			(el as HTMLElement).style.removeProperty(BORDER_VAR);
			el.classList.remove(SCOPE_CLASS, COLOR_CLASS);
		});
	}

	const collectionsPanel = Panels.collections?.node;
	if (collectionsPanel) {
		collectionsPanel.querySelectorAll(`.${SCOPE_CLASS}`).forEach(el => {
			(el as HTMLElement).style.removeProperty(BORDER_VAR);
			el.classList.remove(SCOPE_CLASS, COLOR_CLASS);
		});
		collectionsPanel.querySelectorAll('.hytale_collection_icon_colored').forEach(el => {
			(el as HTMLElement).style.removeProperty('color');
			el.classList.remove('hytale_collection_icon_colored');
		});
	}

	for (let collection of Collection.all) {
		if (collection.export_codec !== 'blockymodel') continue;
		// @ts-expect-error color added by plugin
		let colorIndex: number = collection.color;
		let hasColor = colorIndex != null && colorIndex >= 0;
		let marker = hasColor ? markerColors[colorIndex % markerColors.length] : null;

		// Outliner: scope override + background on all child nodes
		if (outlinerPanel) {
			for (let child of collection.getAllChildren()) {
				let li = outlinerPanel.querySelector(`[id="${child.uuid}"]`);
				if (!li) continue;
				let obj = li.querySelector(':scope > .outliner_object') as HTMLElement | null;
				if (!obj) continue;
				obj.classList.add(SCOPE_CLASS);
				if (marker) {
					if (!minimalColoring) obj.style.setProperty(COLOR_VAR, hexToRgba(marker.pastel, 0.35));
					obj.style.setProperty(BORDER_VAR, marker.standard);
					obj.classList.add(COLOR_CLASS);
				}
			}
		}

		// Collections panel: scope override + tint the icon
		if (collectionsPanel) {
			let li = collectionsPanel.querySelector(`[uuid="${collection.uuid}"]`) as HTMLElement | null;
			if (li) {
				li.classList.add(SCOPE_CLASS);
				if (marker) {
					li.style.setProperty(BORDER_VAR, marker.standard);
					li.classList.add(COLOR_CLASS);
					let icon = li.querySelector(':scope > i.material-icons');
					if (icon) {
						(icon as HTMLElement).style.color = marker.standard;
						icon.classList.add('hytale_collection_icon_colored');
					}
				}
			}
		}
	}
}

export function setupCollectionColor() {
	let colorProperty = new Property(Collection, 'number', 'color', {
		default: -1,
		condition: { formats: FORMAT_IDS }
	});
	track(colorProperty);

	let colorMenuItem: CustomMenuItem = {
		id: 'set_collection_color',
		name: 'menu.cube.color',
		icon: 'color_lens',
		condition: { formats: FORMAT_IDS },
		children() {
			let items: CustomMenuItem[] = [
				{
					icon: 'block',
					name: 'generic.none',
					click() {
						Undo.initEdit({ collections: Collection.selected });
						for (let collection of Collection.selected) {
							// @ts-expect-error
							collection.color = -1;
						}
						Undo.finishEdit('Remove collection color');
						applyCollectionColors();
					}
				}
			];
			for (let i = 0; i < markerColors.length; i++) {
				let color = markerColors[i];
				items.push({
					icon: 'bubble_chart',
					color: color.standard,
					name: color.name || 'cube.color.' + color.id,
					click() {
						Undo.initEdit({ collections: Collection.selected });
						for (let collection of Collection.selected) {
							// @ts-expect-error
							collection.color = i;
						}
						Undo.finishEdit('Set collection color');
						applyCollectionColors();
					}
				});
			}
			return items;
		}
	};
	Collection.menu.addAction(colorMenuItem, '#settings');
	track({
		delete() {
			Collection.menu.removeAction('set_collection_color');
		}
	});

	let setting = new Setting('minimal_attachment_coloring', {
		name: 'Subtle Attachment Colors',
		category: 'edit',
		description: 'Colored attachments will only show a thin line indicator in the outliner instead of a full row highlight.',
		type: 'toggle',
		value: false,
		onChange(value: boolean) {
			minimalColoring = value;
			applyCollectionColors();
		}
	});
	minimalColoring = setting.value as boolean;
	track(setting);

	let style = Blockbench.addCSS(`
		.${SCOPE_CLASS} {
			--color-scope: transparent !important;
		}
		.outliner_object.${COLOR_CLASS}:not(.selected) {
			background-color: var(${COLOR_VAR});
		}
		.${COLOR_CLASS} {
			border-left-color: var(${BORDER_VAR}) !important;
		}
	`);

	let hookFinishedEdit = Blockbench.on('finished_edit', scheduleColorUpdate);
	let hookSelectMode = Blockbench.on('select_mode', scheduleColorUpdate);
	let hookSelection = Blockbench.on('update_selection', scheduleColorUpdate);

	let outlinerList = Panels.outliner?.node?.querySelector('#cubes_list');
	let outlinerObserver: MutationObserver | null = null;
	if (outlinerList) {
		outlinerObserver = new MutationObserver(scheduleColorUpdate);
		outlinerObserver.observe(outlinerList, { childList: true, subtree: true });
	}

	setTimeout(applyCollectionColors, 100);

	track(hookFinishedEdit, hookSelectMode, hookSelection, style, {
		delete() {
			outlinerObserver?.disconnect();
			Panels.outliner?.node?.querySelectorAll(`.${SCOPE_CLASS}`).forEach(el => {
				(el as HTMLElement).style.removeProperty(COLOR_VAR);
				(el as HTMLElement).style.removeProperty(BORDER_VAR);
				el.classList.remove(SCOPE_CLASS, COLOR_CLASS);
			});
			Panels.collections?.node?.querySelectorAll(`.${SCOPE_CLASS}`).forEach(el => {
				(el as HTMLElement).style.removeProperty(BORDER_VAR);
				el.classList.remove(SCOPE_CLASS, COLOR_CLASS);
			});
			Panels.collections?.node?.querySelectorAll('.hytale_collection_icon_colored').forEach(el => {
				(el as HTMLElement).style.removeProperty('color');
				el.classList.remove('hytale_collection_icon_colored');
			});
		}
	});
}
