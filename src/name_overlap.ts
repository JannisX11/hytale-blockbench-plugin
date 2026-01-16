//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { isHytaleFormat } from "./formats";
import { t } from "./i18n";

// @ts-expect-error
const Animation = window.Animation as typeof _Animation;

export function copyAnimationToGroupsWithSameName(animation: _Animation, source_group: Group) {
    let source_animator = animation.getBoneAnimator(source_group);
    let other_groups = Group.all.filter(g => g.name == source_group.name && g != source_group);
    for (let group2 of other_groups) {
        let animator2 = animation.getBoneAnimator(group2);

        for (let channel in animator2.channels) {
            if (animator2[channel] instanceof Array) animator2[channel].empty();
        }
        source_animator.keyframes.forEach(kf => {
            animator2.addKeyframe(kf, guid());
        });
    }
}

export function setupNameOverlap() {

    // Bones with same names
    Blockbench.on('finish_edit', (arg) => {
        if (arg.aspects.keyframes && Animation.selected) {
            let changes = false;
            let groups: Record<string, Group[]> = {};
            if (Timeline.selected_animator) {
                groups[Timeline.selected_animator.name] = [
                    Timeline.selected_animator.group
                ];
            }
            for (let group of Group.all) {
                if (!groups[group.name]) groups[group.name] = [];
                groups[group.name].push(group);
            }
            for (let name in groups) {
                if (groups[name].length >= 2) {
                    copyAnimationToGroupsWithSameName(Animation.selected, groups[name][0]);
                    if (!changes && groups[name].find(g => g.selected)) changes = true;
                }
            }
            if (changes) {
                Animator.preview();
            }
        }
    })

    let bone_animator_select_original = BoneAnimator.prototype.select;
    BoneAnimator.prototype.select = function select(this: BoneAnimator, group_is_selected?: boolean): BoneAnimator {
		if (!this.getGroup()) {
			unselectAllElements();
			return this;
		}
		if (this.group.locked) return;

		for (var key in this.animation.animators) {
			this.animation.animators[key].selected = false;
		}
		if (group_is_selected !== true && this.group) {
			this.group.select();
		}
		GeneralAnimator.prototype.select.call(this);
		
		if (this[Toolbox.selected.animation_channel] && (Timeline.selected.length == 0 || Timeline.selected[0].animator != this) && !Blockbench.hasFlag('loading_selection_save')) {
			var nearest;
			this[Toolbox.selected.animation_channel].forEach(kf => {
				if (Math.abs(kf.time - Timeline.time) < 0.002) {
					nearest = kf;
				}
			})
			if (nearest) {
				nearest.select();
			}
		}

		if (this.group && this.group.parent && this.group.parent !== 'root') {
			this.group.parent.openUp();
		}
		return this;
    }
    track({
        delete() {
            BoneAnimator.prototype.select = bone_animator_select_original;
        }
    })

    let setting = new Setting("hytale_duplicate_bone_names", {
      name: t("settings.duplicate_bones.name"),
      category: "edit",
      description: t("settings.duplicate_bones.description"),
      type: "toggle",
      value: false,
    });
    let override = Group.addBehaviorOverride({
        condition: () => isHytaleFormat() && setting.value == true,
        // @ts-ignore
        priority: 2,
        behavior: {
            unique_name: false
        }
    })
    track(override, setting);
}
