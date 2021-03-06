define([
        '../Core/Check',
        '../Core/createGuid',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/destroyObject'
    ], function(
        Check,
        createGuid,
        defaultValue,
        defined,
        defineProperties,
        destroyObject) {
    'use strict';

    /**
     * A collection of {@link PostProcessStage}s or other post-process composite stages that execute together logically.
     * <p>
     * All stages are executed in the order of the array. The input texture changes based on the value of <code>inputPreviousStageTexture</code>.
     * If <code>inputPreviousStageTexture</code> is <code>true</code>, the input to each stage is the output texture rendered to by the scene or of the stage that executed before it.
     * If <code>inputPreviousStageTexture</code> is <code>false</code>, the input texture is the same for each stage in the composite. The input texture is the texture rendered to by the scene
     * or the output texture of the previous stage.
     * </p>
     *
     * @alias PostProcessStageComposite
     * @constructor
     *
     * @param {Object} options An object with the following properties:
     * @param {Array} options.stages An array of {@link PostProcessStage}s or composites to be executed in order.
     * @param {Boolean} [options.inputPreviousStageTexture=true] Whether to execute each post-process stage where the input to one stage is the output of the previous. Otherwise, the input to each contained stage is the output of the stage that executed before the composite.
     * @param {String} [options.name=createGuid()] The unique name of this post-process stage for reference by other composites. If a name is not supplied, a GUID will be generated.
     * @param {Object} [options.uniforms] An alias to the uniforms of post-process stages.
     *
     * @exception {DeveloperError} options.stages.length must be greater than 0.0.
     *
     * @see PostProcessStage
     *
     * @example
     * // Example 1: separable blur filter
     * // The input to blurXDirection is the texture rendered to by the scene or the output of the previous stage.
     * // The input to blurYDirection is the texture rendered to by blurXDirection.
     * scene.postProcessStages.add(new Cesium.PostProcessStageComposite({
     *     stages : [blurXDirection, blurYDirection]
     * }));
     *
     * @example
     * // Example 2: referencing the output of another post-process stage
     * scene.postProcessStages.add(new Cesium.PostProcessStageComposite({
     *     inputPreviousStageTexture : false,
     *     stages : [
     *         // The same as Example 1.
     *         new Cesium.PostProcessStageComposite({
     *             inputPreviousStageTexture : true
     *             stages : [blurXDirection, blurYDirection],
     *             name : 'blur'
     *         }),
     *         // The input texture for this stage is the same input texture to blurXDirection since inputPreviousStageTexture is false
     *         new Cesium.PostProcessStage({
     *             fragmentShader : compositeShader,
     *             uniforms : {
     *                 blurTexture : 'blur' // The output of the composite with name 'blur' (the texture that blurYDirection rendered to).
     *             }
     *         })
     *     ]
     * });
     *
     * @example
     * // Example 3: create a uniform alias
     * var uniforms = {};
     * Cesium.defineProperties(uniforms, {
     *     filterSize : {
     *         get : function() {
     *             return blurXDirection.uniforms.filterSize;
     *         },
     *         set : function(value) {
     *             blurXDirection.uniforms.filterSize = blurYDirection.uniforms.filterSize = value;
     *         }
     *     }
     * });
     * scene.postProcessStages.add(new Cesium.PostProcessStageComposite({
     *     stages : [blurXDirection, blurYDirection],
     *     uniforms : uniforms
     * }));
     */
    function PostProcessStageComposite(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        //>>includeStart('debug', pragmas.debug);
        Check.defined('options.stages', options.stages);
        Check.typeOf.number.greaterThan('options.stages.length', options.stages.length, 0);
        //>>includeEnd('debug');

        this._stages = options.stages;
        this._inputPreviousStageTexture = defaultValue(options.inputPreviousStageTexture, true);

        var name = options.name;
        if (!defined(name)) {
            name = createGuid();
        }
        this._name = name;

        this._uniforms = options.uniforms;

        // used by PostProcessStageCollection
        this._textureCache = undefined;
        this._index = undefined;

        this._selectedFeatures = undefined;
        this._selectedFeaturesShadow = undefined;
        this._parentSelectedFeatures = undefined;
        this._parentSelectedFeaturesShadow = undefined;
        this._combinedSelectedFeatures = undefined;
        this._combinedSelectedFeaturesShadow = undefined;
        this._selectedFeaturesLength = 0;
        this._parentSelectedFeaturesLength = 0;
        this._selectedFeaturesDirty = true;
    }

    defineProperties(PostProcessStageComposite.prototype, {
        /**
         * Determines if this post-process stage is ready to be executed.
         *
         * @memberof PostProcessStageComposite.prototype
         * @type {Boolean}
         * @readonly
         */
        ready : {
            get : function() {
                var stages = this._stages;
                var length = stages.length;
                for (var i = 0; i < length; ++i) {
                    if (!stages[i].ready) {
                        return false;
                    }
                }
                return true;
            }
        },
        /**
         * The unique name of this post-process stage for reference by other stages in a PostProcessStageComposite.
         *
         * @memberof PostProcessStageComposite.prototype
         * @type {String}
         * @readonly
         */
        name : {
            get : function() {
                return this._name;
            }
        },
        /**
         * Whether or not to execute this post-process stage when ready.
         *
         * @memberof PostProcessStageComposite.prototype
         * @type {Boolean}
         */
        enabled : {
            get : function() {
                return this._stages[0].enabled;
            },
            set : function(value) {
                var stages = this._stages;
                var length = stages.length;
                for (var i = 0; i < length; ++i) {
                    stages[i].enabled = value;
                }
            }
        },
        /**
         * An alias to the uniform values of the post-process stages. May be <code>undefined</code>; in which case, get each stage to set uniform values.
         * @memberof PostProcessStageComposite.prototype
         * @type {Object}
         */
        uniforms : {
            get : function() {
                return this._uniforms;
            }
        },
        /**
         * All post-process stages are executed in the order of the array. The input texture changes based on the value of <code>inputPreviousStageTexture</code>.
         * If <code>inputPreviousStageTexture</code> is <code>true</code>, the input to each stage is the output texture rendered to by the scene or of the stage that executed before it.
         * If <code>inputPreviousStageTexture</code> is <code>false</code>, the input texture is the same for each stage in the composite. The input texture is the texture rendered to by the scene
         * or the output texture of the previous stage.
         *
         * @memberof PostProcessStageComposite.prototype
         * @type {Boolean}
         * @readonly
         */
        inputPreviousStageTexture : {
            get : function() {
                return this._inputPreviousStageTexture;
            }
        },
        /**
         * The number of post-process stages in this composite.
         *
         * @memberof PostProcessStageComposite.prototype
         * @type {Number}
         * @readonly
         */
        length : {
            get : function() {
                return this._stages.length;
            }
        },
        /**
         * The features selected for applying the post-process.
         *
         * @memberof PostProcessStageComposite.prototype
         * @type {Array}
         */
        selectedFeatures : {
            get : function() {
                return this._selectedFeatures;
            },
            set : function(value) {
                this._selectedFeatures = value;
            }
        },
        /**
         * @private
         */
        parentSelectedFeatures : {
            get : function() {
                return this._parentSelectedFeatures;
            },
            set : function(value) {
                this._parentSelectedFeatures = value;
            }
        }
    });

    /**
     * @private
     */
    PostProcessStageComposite.prototype._isSupported = function(context) {
        var stages = this._stages;
        var length = stages.length;
        for (var i = 0; i < length; ++i) {
            if (!stages[i]._isSupported(context)) {
                return false;
            }
        }
        return true;
    };

    /**
     * Whether or not this post process stage is supported.
     * <p>
     * A post process stage is not supported when it requires a depth texture and the WEBGL_depth_texture extension is not
     * supported.
     * </p>
     *
     * @param {Scene} scene The scene.
     * @return {Boolean} Whether this post process stage is supported.
     *
     * @see {Context#depthTexture}
     * @see {@link http://www.khronos.org/registry/webgl/extensions/WEBGL_depth_texture/|WEBGL_depth_texture}
     */
    PostProcessStageComposite.prototype.isSupported = function(scene) {
        //>>includeStart('debug', pragmas.debug);
        Check.typeOf.object('scene', scene);
        //>>includeEnd('debug');
        return this._isSupported(scene.context);
    };

    /**
     * Gets the post-process stage at <code>index</code>
     *
     * @param {Number} index The index of the post-process stage or composite.
     * @return {PostProcessStage|PostProcessStageComposite} The post-process stage or composite at index.
     *
     * @exception {DeveloperError} index must be greater than or equal to 0.
     * @exception {DeveloperError} index must be less than {@link PostProcessStageComposite#length}.
     */
    PostProcessStageComposite.prototype.get = function(index) {
        //>>includeStart('debug', pragmas.debug);
        Check.typeOf.number.greaterThanOrEquals('index', index, 0);
        Check.typeOf.number.lessThan('index', index, this.length);
        //>>includeEnd('debug');
        return this._stages[index];
    };

    function isSelectedTextureDirty(stage) {
        var length = defined(stage._selectedFeatures) ? stage._selectedFeatures.length : 0;
        var parentLength = defined(stage._parentSelectedFeatures) ? stage._parentSelectedFeatures : 0;
        var dirty = stage._selectedFeatures !== stage._selectedFeaturesShadow || length !== stage._selectedFeaturesLength;
        dirty = dirty || stage._parentSelectedFeatures !== stage._parentSelectedFeaturesShadow || parentLength !== stage._parentSelectedFeaturesLength;

        if (defined(stage._selectedFeatures) && defined(stage._parentSelectedFeatures)) {
            stage._combinedSelectedFeatures = stage._selectedFeatures.concat(stage._parentSelectedFeatures);
        } else if (defined(stage._parentSelectedFeatures)) {
            stage._combinedSelectedFeatures = stage._parentSelectedFeatures;
        } else {
            stage._combinedSelectedFeatures = stage._selectedFeatures;
        }

        if (!dirty && defined(stage._combinedSelectedFeatures)) {
            if (!defined(stage._combinedSelectedFeaturesShadow)) {
                return true;
            }

            length = stage._combinedSelectedFeatures.length;
            for (var i = 0; i < length; ++i) {
                if (stage._combinedSelectedFeatures[i] !== stage._combinedSelectedFeaturesShadow[i]) {
                    return true;
                }
            }
        }
        return dirty;
    }

    /**
     * A function that will be called before execute. Updates each post-process stage in the composite.
     * @param {Context} context The context.
     * @private
     */
    PostProcessStageComposite.prototype.update = function(context, useLogDepth) {
        this._selectedFeaturesDirty = isSelectedTextureDirty(this);

        this._selectedFeaturesShadow = this._selectedFeatures;
        this._parentSelectedFeaturesShadow = this._parentSelectedFeatures;
        this._combinedSelectedFeaturesShadow = this._combinedSelectedFeatures;
        this._selectedFeaturesLength = defined(this._selectedFeatures) ? this._selectedFeatures.length : 0;
        this._parentSelectedFeaturesLength = defined(this._parentSelectedFeatures) ? this._parentSelectedFeatures.length : 0;

        var stages = this._stages;
        var length = stages.length;
        for (var i = 0; i < length; ++i) {
            var stage = stages[i];
            if (this._selectedFeaturesDirty) {
                stage.parentSelectedFeatures = this._combinedSelectedFeatures;
            }
            stage.update(context, useLogDepth);
        }
    };

    /**
     * Returns true if this object was destroyed; otherwise, false.
     * <p>
     * If this object was destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
     * </p>
     *
     * @returns {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
     *
     * @see PostProcessStageComposite#destroy
     */
    PostProcessStageComposite.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
     * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
     * <p>
     * Once an object is destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
     * assign the return value (<code>undefined</code>) to the object as done in the example.
     * </p>
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see PostProcessStageComposite#isDestroyed
     */
    PostProcessStageComposite.prototype.destroy = function() {
        var stages = this._stages;
        var length = stages.length;
        for (var i = 0; i < length; ++i) {
            stages[i].destroy();
        }
        return destroyObject(this);
    };

    return PostProcessStageComposite;
});
