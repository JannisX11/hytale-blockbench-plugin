This plugin adds support for the `.blockymodel` and `.blockyanim` file formats that can be used to create and edit models for Hytale.

Select a Hytale format from the start screen and click Create New Model to get started!

## Features

### Hytale modeling support
* Support for opening, editing, and saving models for Hytale
* A customized workspace and validation to ensure models are created in a compatible way
* Automatic UV sizes that are locked to face dimensions to ensure UV consistency
* The stretch tool and sliders can be used to adjust cube sizes without affecting UV
* Attachment support built on collections. Attachments are anything from hairstyles to clothing items and weapons that can alter the design of a character. Use the isPiece flag on attachment groups to mark them for proper export.

### Hytale animation support
* Support for animations for Hytale models
* Visibility keyframes
* Quaternion-based interpolation
* Keyframe-wrapping for looping animations

### Quality-of-life features that the Hytale team uses!
* A thicker and always visible pivot marker to ensure the pivot point is well visible. The group pivot is also shown when editing child cubes, so you always know where geometry will rotate from when animating.
* UV Cycling: Click in the UV editor multiple times to cycle between overlapping faces at that spot
* Improved UV editor clarity and visibility to make texture mapping easier to work with
* Copy-Paste with Magenta Alpha setting, to improve copy-pasting from and to Photoshop (which doesn't support copy pasting with transparency)

## Usage tips

### Guidelines
* As a size reference, the center grid in a new Hytale project represents one block in-game. This measures either 32 pixels for props and blocks or 64 pixels for characters and attachments.
* Models should not have more than 255 nodes. Nodes are a concept in the Hytale model format, each group counts as a node, and each cube/quad counts except if it's the first cube in a respective group. The number of nodes can be seen by clicking on the element counter above the outliner.
* UVs should always the dimensions of their face, deviating sizes will not be included in the exported model.

