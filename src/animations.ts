//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";
import { getMainShape } from "./util";


export function setupAnimation() {

    // Visibility
    function displayVisibility(animator: BoneAnimator) {
        let group = animator.getGroup();
        let scene_object = group.scene_object;
        if (animator.muted.visibility) {
            scene_object.visible = group.visibility;
            return;
        }

        let previous_keyframe;
        let previous_time = -Infinity;
        for (let keyframe of (animator.visibility as _Keyframe[])) {
            if (keyframe.time <= Timeline.time && keyframe.time > previous_time) {
                previous_keyframe = keyframe;
                previous_time = keyframe.time;
            }
        }
        if (previous_keyframe && scene_object) {
            scene_object.visible = previous_keyframe.data_points[0]?.visibility != false;
        } else if (scene_object) {
            scene_object.visible = group.visibility;
        }
    }
    BoneAnimator.addChannel('visibility', {
        name: 'Visibility',
        mutable: true,
        transform: false,
        max_data_points: 1,
        condition: {formats: FORMAT_IDS},
        displayFrame(animator: BoneAnimator, multiplier: number) {
            displayVisibility(animator);
        }
    });
    let property = new Property(KeyframeDataPoint, 'boolean', 'visibility', {
        label: 'Visibility',
        condition: (point: KeyframeDataPoint) => point.keyframe.channel == 'visibility',
        default: true
    });
    track(property);

    
    // Playback
    function weightedCubicBezier(t: number): number {
        // Control points
        let P0 = 0.0, P1 = 0.05, P2 = 0.95, P3 = 1.0;
        // Weights
        let W0 = 2.0, W1 = 1.0, W2 = 2.0, W3 = 1.0;

        let b0 = (1 - t) ** 3;
        let b1 = 3 * (1 - t) ** 2 * t;
        let b2 = 3 * (1 - t) * t ** 2;
        let b3 = t ** 3;
        let w0 = b0 * W0;
        let w1 = b1 * W1;
        let w2 = b2 * W2;
        let w3 = b3 * W3;

        // Weighted sum of points
        let numerator = w0 * P0 + w1 * P1 + w2 * P2 + w3 * P3;
        let denominator = w0 + w1 + w2 + w3;

        return numerator / denominator;
    }
    let on_interpolate = Blockbench.on('interpolate_keyframes', arg => {
        if (!isHytaleFormat()) return;
        if (!arg.use_quaternions || !arg.t || arg.t == 1) return;
        if (arg.keyframe_before.interpolation != 'catmullrom' || arg.keyframe_after.interpolation != 'catmullrom') return;
        return {
            t: weightedCubicBezier(arg.t)
        }
    });
    track(on_interpolate);

    let original_display_scale = BoneAnimator.prototype.displayScale;
    let original_display_rotation = BoneAnimator.prototype.displayRotation;
    let original_show_default_pose = Animator.showDefaultPose;
    BoneAnimator.prototype.displayScale = function displayScale(array, multiplier = 1) {
		if (!array) return this;

        if (isHytaleFormat()) {
            let target_shape: Cube = getMainShape(this.group);
            if (target_shape) {
                let initial_stretch = target_shape.stretch.slice() as ArrayVector3;
                target_shape.stretch.V3_set([
                    initial_stretch[0] * (1 + (array[0] - 1) * multiplier),
                    initial_stretch[1] * (1 + (array[1] - 1) * multiplier),
                    initial_stretch[2] * (1 + (array[2] - 1) * multiplier),
                ])
                Cube.preview_controller.updateGeometry(target_shape);
                target_shape.stretch.V3_set(initial_stretch);
            }
            return this;
        }
        
        return original_display_scale.call(this, array, multiplier);
    }
    BoneAnimator.prototype.displayRotation = function displayRotation(array, multiplier = 1) {
        if (isHytaleFormat() && array) {
		    let bone = this.group.scene_object;
			let euler = Reusable.euler1.set(
				Math.degToRad(array[0]) * multiplier,
				Math.degToRad(array[1]) * multiplier,
				Math.degToRad(array[2]) * multiplier,
				bone.rotation.order
			)
			let q2 = Reusable.quat2.setFromEuler(euler);
			bone.quaternion.multiply(q2);
			return this;
        }
        
        return original_display_rotation.call(this, array, multiplier);
    }
    Animator.showDefaultPose = function(reduced_updates, ...args) {
        original_show_default_pose(reduced_updates, ...args);
        if (isHytaleFormat()) {
            for (let cube of Cube.all) {
                Cube.preview_controller.updateGeometry(cube);
            }
        }
    }
    track({
        delete() {
            BoneAnimator.prototype.displayScale = original_display_scale;
            BoneAnimator.prototype.displayRotation = original_display_rotation;
            Animator.showDefaultPose = original_show_default_pose;
        }
    })
}
