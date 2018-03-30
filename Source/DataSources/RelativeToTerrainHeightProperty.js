define([
    '../Core/defaultValue',
    '../Core/defined',
    '../Core/defineProperties',
    '../Core/isArray',
    '../Core/Cartesian3',
    '../Core/Cartographic',
    '../Core/Check',
    '../Core/Event',
    '../Core/Iso8601',
    '../Core/Rectangle',
    '../Core/RuntimeError',
    './createPropertyDescriptor',
    './Property'
], function(
    defaultValue,
    defined,
    defineProperties,
    isArray,
    Cartesian3,
    Cartographic,
    Check,
    Event,
    Iso8601,
    Rectangle,
    RuntimeError,
    createPropertyDescriptor,
    Property) {
    'use strict';

    var normalScratch = new Cartesian3();

    /**
     * A {@link Property} which evaluates to a Number based on the height of terrain
     * within the bounds of the provided positions.
     *
     * @alias RelativeToTerrainHeightProperty
     * @constructor
     *
     * @param {Scene} scene The scene
     * @param {PositionProperty} position A Property specifying the position the height should be relative to.
     * @param {Property} [heightRelativeToTerrain] A Property specifying the numeric height value relative to terrain
     *
     * @example
     * var hierarchy = new Cesium.ConstantProperty(polygonPositions);
     * var redPolygon = viewer.entities.add({
     *     ellipse : {
     *         hierarchy : hierarchy,
     *         material : Cesium.Color.RED,
     *         height : new Cesium.RelativeToTerrainHeightProperty(viewer.terrainProvider, positions, 11.0)
     *     }
     * });
     */
    function RelativeToTerrainHeightProperty(scene, position) {
        //>>includeStart('debug', pragmas.debug);
        Check.defined('scene', scene);
        //>>includeEnd('debug');

        this._position = undefined;
        this._subscription = undefined;
        this._definitionChanged = new Event();

        this._scene = scene;
        this._terrainPosition = new Cartesian3();
        this._removeCallbackFunc = undefined;

        this.position = position;
    }

    defineProperties(RelativeToTerrainHeightProperty.prototype, {
        /**
         * Gets a value indicating if this property is constant.
         * @memberof RelativeToTerrainHeightProperty.prototype
         *
         * @type {Boolean}
         * @readonly
         */
        isConstant : {
            get : function() {
                return false;
            }
        },
        /**
         * Gets the event that is raised whenever the definition of this property changes.
         * @memberof RelativeToTerrainHeightProperty.prototype
         *
         * @type {Event}
         * @readonly
         */
        definitionChanged : {
            get : function() {
                return this._definitionChanged;
            }
        },
        /**
         * Gets or sets the position property used to compute the value.
         * @memberof RelativeToTerrainHeightProperty.prototype
         *
         * @type {PositionProperty}
         */
        position : {
            get : function() {
                return this._position;
            },
            set : function(value) {
                var oldValue = this._positions;
                if (oldValue !== value) {
                    if (defined(oldValue)) {
                        this._subscription();
                    }

                    this._position = value;

                    if (defined(value)) {
                        this._subscription = value._definitionChanged.addEventListener(function() {
                            this._updateClamping();
                        }, this);
                    }

                    this._updateClamping();
                }
            }
        }
    });

    /**
     * @private
     */
    RelativeToTerrainHeightProperty.prototype._updateClamping = function() {
        var scene = this._scene;
        var globe = scene.globe;
        var ellipsoid = globe.ellipsoid;
        var surface = globe._surface;

        var property = this._position;
        var position = Property.getValueOrUndefined(property, Iso8601.MINIMUM_VALUE);
        if (!defined(position)) {
            return;
        }

        if (defined(this._removeCallbackFunc)) {
            this._removeCallbackFunc();
        }

        var that = this;
        var cartographicPosition = ellipsoid.cartesianToCartographic(position); //TODO result param

        function updateFunction(clampedPosition) {
            that._terrainPosition = Cartesian3.clone(clampedPosition, that._terrainPosition);
        }
        this._removeCallbackFunc = surface.updateHeight(cartographicPosition, updateFunction);

        var height = globe.getHeight(cartographicPosition);
        if (defined(height)) {
            cartographicPosition.height = height;
            this._terrainPosition = ellipsoid.cartographicToCartesian(cartographicPosition, this._terrainPosition);
        } else {
            this._terrainPosition = Cartesian3.clone(position);
        }
    };

    /**
     * Gets the height relative to the terrain based on the positions.
     *
     * @returns {Number} The height relative to terrain
     */
    RelativeToTerrainHeightProperty.prototype.getValue = function() {
        var position = Property.getValueOrUndefined(this._position, Iso8601.MINIMUM_VALUE); //TODO: what do I do for time varying position?
        if (!defined(position)) {
            return;
        }
        return this._terrainPosition;
    };

    /**
     * Compares this property to the provided property and returns
     * <code>true</code> if they are equal, <code>false</code> otherwise.
     *
     * @param {Property} [other] The other property.
     * @returns {Boolean} <code>true</code> if left and right are equal, <code>false</code> otherwise.
     */
    RelativeToTerrainHeightProperty.prototype.equals = function(other) {
        return this === other ||//
               (other instanceof RelativeToTerrainHeightProperty &&
                this._scene === other._scene &&
                Property.equals(this._position, other._position));
    };

    return RelativeToTerrainHeightProperty;
});
