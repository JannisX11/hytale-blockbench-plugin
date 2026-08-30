//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { isHytaleFormat } from "./formats";

// @ts-expect-error
const Animation = window.Animation as typeof BBAnimation;

export function copyAnimationToGroupsWithSameName(animation: BBAnimation, source_group: Group) {
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
        if (isHytaleFormat() && arg.aspects.keyframes && Animation.selected) {
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

    let setting = new Setting('hytale_duplicate_bone_names', {
        name: 'Duplicate Bone Names',
        category: 'edit',
        description: 'Allow creating duplicate groups names in Hytale formats. Multiple groups with the same name can be used to apply animations to multiple nodes at once.',
        type: 'toggle',
        value: false
    })
    let override = Group.addBehaviorOverride({
        condition: () => isHytaleFormat() && setting.value == true,
        priority: 2,
        behavior: {
            unique_name: false
        }
    })
    track(override, setting);
}
