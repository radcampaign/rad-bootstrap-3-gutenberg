/**
 * Most of this is an overwrite of @wordpress/editor/src/componenets/block-list/block.js
 * so that we could add column wrappers in the right place
 */

/**
 * External dependencies
 */
import classnames from 'classnames';
import { get, reduce, size, first, last } from 'lodash';

/**
 * WordPress dependencies
 */
import { Component, Fragment } from 'wp.element';
import {
	focus,
	isTextField,
	placeCaretAtHorizontalEdge,
	placeCaretAtVerticalEdge,
} from 'wp.dom';
import { BACKSPACE, DELETE, ENTER } from 'wp.keycodes';
import {
	getBlockType,
	getSaveElement,
	isReusableBlock,
	isUnmodifiedDefaultBlock,
	getUnregisteredTypeHandlerName,
} from 'wp.blocks';
import { KeyboardShortcuts, withFilters } from 'wp.components';
import { __, sprintf } from 'wp.i18n';
import { withDispatch, withSelect } from 'wp.data';
import { withViewportMatch } from 'wp.viewport';
import { compose } from 'wp.compose';
import { createElement as el } from 'wp.element';

/**
 * Internal dependencies
 */
import {
	BlockEdit,
	BlockMover,
	Inserter,
} from 'wp.editor';

import BlockDropZone from '@wordpress/editor/build-module/components/block-drop-zone';
import BlockInvalidWarning from '@wordpress/editor/build-module/components/block-list/block-invalid-warning.js';
import BlockCrashWarning from '@wordpress/editor/build-module/components/block-list/block-crash-warning.js';
import BlockCrashBoundary from '@wordpress/editor/build-module/components/block-list/block-crash-boundary.js';
import BlockHtml from '@wordpress/editor/build-module/components/block-list/block-html.js';
import BlockBreadcrumb from '@wordpress/editor/build-module/components/block-list/breadcrumb.js';
import BlockContextualToolbar from '@wordpress/editor/build-module/components/block-list/block-contextual-toolbar.js';
import BlockMultiControls from '@wordpress/editor/build-module/components/block-list/multi-controls.js';
import BlockMobileToolbar from '@wordpress/editor/build-module/components/block-list/block-mobile-toolbar.js';
import BlockInsertionPoint from '@wordpress/editor/build-module/components/block-list/insertion-point.js';
import IgnoreNestedEvents from '@wordpress/editor/build-module/components/ignore-nested-events';
import InserterWithShortcuts from '@wordpress/editor/build-module/components/inserter-with-shortcuts';
import HoverArea from '@wordpress/editor/build-module/components/block-list/hover-area.js';
import { isInsideRootBlock } from '@wordpress/editor/build-module/utils/dom.js';

export class BlockListBlock extends Component {
	constructor() {
		super( ...arguments );

		this.setBlockListRef = this.setBlockListRef.bind( this );
		this.bindBlockNode = this.bindBlockNode.bind( this );
		this.setAttributes = this.setAttributes.bind( this );
		this.maybeHover = this.maybeHover.bind( this );
		this.forceFocusedContextualToolbar = this.forceFocusedContextualToolbar.bind( this );
		this.hideHoverEffects = this.hideHoverEffects.bind( this );
		this.insertBlocksAfter = this.insertBlocksAfter.bind( this );
		this.onFocus = this.onFocus.bind( this );
		this.preventDrag = this.preventDrag.bind( this );
		this.onPointerDown = this.onPointerDown.bind( this );
		this.deleteOrInsertAfterWrapper = this.deleteOrInsertAfterWrapper.bind( this );
		this.onBlockError = this.onBlockError.bind( this );
		this.onTouchStart = this.onTouchStart.bind( this );
		this.onClick = this.onClick.bind( this );
		this.onDragStart = this.onDragStart.bind( this );
		this.onDragEnd = this.onDragEnd.bind( this );
		this.selectOnOpen = this.selectOnOpen.bind( this );
		this.hadTouchStart = false;

		this.state = {
			error: null,
			dragging: false,
			isHovered: false,
		};
		this.isForcingContextualToolbar = false;
	}

	componentDidMount() {
		if ( this.props.isSelected ) {
			this.focusTabbable();
		}
	}

	componentDidUpdate( prevProps ) {
		if ( this.isForcingContextualToolbar ) {
			// The forcing of contextual toolbar should only be true during one update,
			// after the first update normal conditions should apply.
			this.isForcingContextualToolbar = false;
		}
		if ( this.props.isTypingWithinBlock || this.props.isSelected ) {
			this.hideHoverEffects();
		}

		if ( this.props.isSelected && ! prevProps.isSelected ) {
			this.focusTabbable( true );
		}

		// When triggering a multi-selection,
		// move the focus to the wrapper of the first selected block.
		if ( this.props.isFirstMultiSelected && ! prevProps.isFirstMultiSelected ) {
			this.wrapperNode.focus();
		}
	}

	setBlockListRef( node ) {
		this.wrapperNode = node;
		this.props.blockRef( node, this.props.clientId );

		// We need to rerender to trigger a rerendering of HoverArea
		// it depents on this.wrapperNode but we can't keep this.wrapperNode in state
		// Because we need it to be immediately availeble for `focusableTabbable` to work.
		this.forceUpdate();
	}

	bindBlockNode( node ) {
		this.node = node;
	}

	/**
	 * When a block becomes selected, transition focus to an inner tabbable.
	 *
	 * @param {boolean} ignoreInnerBlocks Should not focus inner blocks.
	 */
	focusTabbable( ignoreInnerBlocks ) {
		const { initialPosition } = this.props;

		// Focus is captured by the wrapper node, so while focus transition
		// should only consider tabbables within editable display, since it
		// may be the wrapper itself or a side control which triggered the
		// focus event, don't unnecessary transition to an inner tabbable.
		if ( this.wrapperNode.contains( document.activeElement ) ) {
			return;
		}

		// Find all tabbables within node.
		const textInputs = focus.tabbable
			.find( this.node )
			.filter( isTextField )
			// Exclude inner blocks
			.filter( ( node ) => ! ignoreInnerBlocks || isInsideRootBlock( this.node, node ) );

		// If reversed (e.g. merge via backspace), use the last in the set of
		// tabbables.
		const isReverse = -1 === initialPosition;
		const target = ( isReverse ? last : first )( textInputs );

		if ( ! target ) {
			this.wrapperNode.focus();
			return;
		}

		target.focus();

		// In reverse case, need to explicitly place caret position.
		if ( isReverse ) {
			placeCaretAtHorizontalEdge( target, true );
			placeCaretAtVerticalEdge( target, true );
		}
	}

	setAttributes( attributes ) {
		const { clientId, name, onChange } = this.props;
		const type = getBlockType( name );
		onChange( clientId, attributes );

		const metaAttributes = reduce(
			attributes,
			( result, value, key ) => {
				if ( get( type, [ 'attributes', key, 'source' ] ) === 'meta' ) {
					result[ type.attributes[ key ].meta ] = value;
				}

				return result;
			},
			{}
		);

		if ( size( metaAttributes ) ) {
			this.props.onMetaChange( metaAttributes );
		}
	}

	onTouchStart() {
		// Detect touchstart to disable hover on iOS
		this.hadTouchStart = true;
	}

	onClick() {
		// Clear touchstart detection
		// Browser will try to emulate mouse events also see https://www.html5rocks.com/en/mobile/touchandmouse/
		this.hadTouchStart = false;
	}

	/**
	 * A mouseover event handler to apply hover effect when a pointer device is
	 * placed within the bounds of the block. The mouseover event is preferred
	 * over mouseenter because it may be the case that a previous mouseenter
	 * event was blocked from being handled by a IgnoreNestedEvents component,
	 * therefore transitioning out of a nested block to the bounds of the block
	 * would otherwise not trigger a hover effect.
	 *
	 * @see https://developer.mozilla.org/en-US/docs/Web/Events/mouseenter
	 */
	maybeHover() {
		const { isPartOfMultiSelection, isSelected } = this.props;
		const { isHovered } = this.state;

		if (
			isHovered ||
			isPartOfMultiSelection ||
			isSelected ||
			this.props.isMultiSelecting ||
			this.hadTouchStart
		) {
			return;
		}

		this.setState( { isHovered: true } );
	}

	/**
	 * Sets the block state as unhovered if currently hovering. There are cases
	 * where mouseleave may occur but the block is not hovered (multi-select),
	 * so to avoid unnecesary renders, the state is only set if hovered.
	 */
	hideHoverEffects() {
		if ( this.state.isHovered ) {
			this.setState( { isHovered: false } );
		}
	}

	insertBlocksAfter( blocks ) {
		this.props.onInsertBlocks( blocks, this.props.order + 1 );
	}

	/**
	 * Marks the block as selected when focused and not already selected. This
	 * specifically handles the case where block does not set focus on its own
	 * (via `setFocus`), typically if there is no focusable input in the block.
	 *
	 * @return {void}
	 */
	onFocus() {
		if ( ! this.props.isSelected && ! this.props.isPartOfMultiSelection ) {
			this.props.onSelect();
		}
	}

	/**
	 * Prevents default dragging behavior within a block to allow for multi-
	 * selection to take effect unhampered.
	 *
	 * @param {DragEvent} event Drag event.
	 *
	 * @return {void}
	 */
	preventDrag( event ) {
		event.preventDefault();
	}

	/**
	 * Begins tracking cursor multi-selection when clicking down within block.
	 *
	 * @param {MouseEvent} event A mousedown event.
	 *
	 * @return {void}
	 */
	onPointerDown( event ) {
		// Not the main button.
		// https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/button
		if ( event.button !== 0 ) {
			return;
		}

		if ( event.shiftKey ) {
			if ( ! this.props.isSelected ) {
				this.props.onShiftSelection();
				event.preventDefault();
			}
		} else {
			this.props.onSelectionStart( this.props.clientId );

			// Allow user to escape out of a multi-selection to a singular
			// selection of a block via click. This is handled here since
			// onFocus excludes blocks involved in a multiselection, as
			// focus can be incurred by starting a multiselection (focus
			// moved to first block's multi-controls).
			if ( this.props.isPartOfMultiSelection ) {
				this.props.onSelect();
			}
		}
	}

	/**
	 * Interprets keydown event intent to remove or insert after block if key
	 * event occurs on wrapper node. This can occur when the block has no text
	 * fields of its own, particularly after initial insertion, to allow for
	 * easy deletion and continuous writing flow to add additional content.
	 *
	 * @param {KeyboardEvent} event Keydown event.
	 */
	deleteOrInsertAfterWrapper( event ) {
		const { keyCode, target } = event;

		if (
			! this.props.isSelected ||
			target !== this.wrapperNode ||
			this.props.isLocked
		) {
			return;
		}

		switch ( keyCode ) {
			case ENTER:
				// Insert default block after current block if enter and event
				// not already handled by descendant.
				this.props.onInsertDefaultBlockAfter();
				event.preventDefault();
				break;

			case BACKSPACE:
			case DELETE:
				// Remove block on backspace.
				const { clientId, onRemove } = this.props;
				onRemove( clientId );
				event.preventDefault();
				break;
		}
	}

	onBlockError( error ) {
		this.setState( { error } );
	}

	onDragStart() {
		this.setState( { dragging: true } );
	}

	onDragEnd() {
		this.setState( { dragging: false } );
	}

	selectOnOpen( open ) {
		if ( open && ! this.props.isSelected ) {
			this.props.onSelect();
		}
	}

	forceFocusedContextualToolbar() {
		this.isForcingContextualToolbar = true;
		// trigger a re-render
		this.setState( () => ( {} ) );
	}

	columnClass(attributes) {
		let size = attributes.size,
				breakSize = attributes.breakSize;
		return 'col-' + breakSize + '-' + size;
	}

	render() {
		var _this3 = this;
		var createElement = el;

		let columnClass = this.columnClass(this.props.attributes);

    return createElement(HoverArea, {
      container: this.wrapperNode
    }, function (_ref) {
      var hoverArea = _ref.hoverArea;
      var _this3$props = _this3.props,
          order = _this3$props.order,
          mode = _this3$props.mode,
          isFocusMode = _this3$props.isFocusMode,
          hasFixedToolbar = _this3$props.hasFixedToolbar,
          isLocked = _this3$props.isLocked,
          isFirst = _this3$props.isFirst,
          isLast = _this3$props.isLast,
          clientId = _this3$props.clientId,
          rootClientId = _this3$props.rootClientId,
          isSelected = _this3$props.isSelected,
          isPartOfMultiSelection = _this3$props.isPartOfMultiSelection,
          isFirstMultiSelected = _this3$props.isFirstMultiSelected,
          isTypingWithinBlock = _this3$props.isTypingWithinBlock,
          isCaretWithinFormattedText = _this3$props.isCaretWithinFormattedText,
          isMultiSelecting = _this3$props.isMultiSelecting,
          isEmptyDefaultBlock = _this3$props.isEmptyDefaultBlock,
          isMovable = _this3$props.isMovable,
          isParentOfSelectedBlock = _this3$props.isParentOfSelectedBlock,
          isDraggable = _this3$props.isDraggable,
          className = _this3$props.className,
          name = _this3$props.name,
          isValid = _this3$props.isValid,
          attributes = _this3$props.attributes;
      var isHovered = _this3.state.isHovered && !isMultiSelecting;
      var blockType = getBlockType(name); // translators: %s: Type of block (i.e. Text, Image etc)

      var blockLabel = sprintf(__('Block: %s'), blockType.title); // The block as rendered in the editor is composed of general block UI
      // (mover, toolbar, wrapper) and the display of the block content.

      var isUnregisteredBlock = name === getUnregisteredTypeHandlerName(); // If the block is selected and we're typing the block should not appear.
      // Empty paragraph blocks should always show up as unselected.

      var showEmptyBlockSideInserter = (isSelected || isHovered) && isEmptyDefaultBlock && isValid;
      var showSideInserter = (isSelected || isHovered) && isEmptyDefaultBlock;
      var shouldAppearSelected = !isFocusMode && !showSideInserter && isSelected && !isTypingWithinBlock;
      var shouldAppearHovered = !isFocusMode && !hasFixedToolbar && isHovered && !isEmptyDefaultBlock; // We render block movers and block settings to keep them tabbale even if hidden

      var shouldRenderMovers = !isFocusMode && (isSelected || hoverArea === 'left') && !showEmptyBlockSideInserter && !isMultiSelecting && !isPartOfMultiSelection && !isTypingWithinBlock;
      var shouldShowBreadcrumb = !isFocusMode && isHovered && !isEmptyDefaultBlock;
      var shouldShowContextualToolbar = !hasFixedToolbar && !showSideInserter && (isSelected && (!isTypingWithinBlock || isCaretWithinFormattedText) || isFirstMultiSelected);
      var shouldShowMobileToolbar = shouldAppearSelected;
      var _this3$state = _this3.state,
          error = _this3$state.error,
          dragging = _this3$state.dragging; // Insertion point can only be made visible if the block is at the
      // the extent of a multi-selection, or not in a multi-selection.

      var shouldShowInsertionPoint = isPartOfMultiSelection && isFirstMultiSelected || !isPartOfMultiSelection; // The wp-block className is important for editor styles.
      // Generate the wrapper class names handling the different states of the block.

      var wrapperClassName = classnames('wp-block editor-block-list__block', {
        'has-warning': !isValid || !!error || isUnregisteredBlock,
        'is-selected': shouldAppearSelected,
        'is-multi-selected': isPartOfMultiSelection,
        'is-hovered': shouldAppearHovered,
        'is-reusable': isReusableBlock(blockType),
        'is-dragging': dragging,
        'is-typing': isTypingWithinBlock,
        'is-focused': isFocusMode && (isSelected || isParentOfSelectedBlock),
        'is-focus-mode': isFocusMode
      }, className);
      var onReplace = _this3.props.onReplace; // Determine whether the block has props to apply to the wrapper.

      var wrapperProps = _this3.props.wrapperProps;

      if (blockType.getEditWrapperProps) {
        wrapperProps = _objectSpread({}, wrapperProps, blockType.getEditWrapperProps(attributes));
      }

      var blockElementId = "block-".concat(clientId); // We wrap the BlockEdit component in a div that hides it when editing in
      // HTML mode. This allows us to render all of the ancillary pieces
      // (InspectorControls, etc.) which are inside `BlockEdit` but not
      // `BlockHTML`, even in HTML mode.

      var blockEdit = createElement(BlockEdit, {
        name: name,
        isSelected: isSelected,
        attributes: attributes,
        setAttributes: _this3.setAttributes,
        insertBlocksAfter: isLocked ? undefined : _this3.insertBlocksAfter,
        onReplace: isLocked ? undefined : onReplace,
        mergeBlocks: isLocked ? undefined : _this3.props.onMerge,
        clientId: clientId,
        isSelectionEnabled: _this3.props.isSelectionEnabled,
        toggleSelection: _this3.props.toggleSelection
      });

      if (mode !== 'visual') {
        blockEdit = createElement("div", {
          style: {
            display: 'none'
          }
        }, blockEdit);
      }

      let retBlocks = createElement(IgnoreNestedEvents, {
        id: blockElementId,
        ref: _this3.setBlockListRef,
        onMouseOver: _this3.maybeHover,
        onMouseOverHandled: _this3.hideHoverEffects,
        onMouseLeave: _this3.hideHoverEffects,
        className: wrapperClassName,
        "data-type": name,
        onTouchStart: _this3.onTouchStart,
        onFocus: _this3.onFocus,
        onClick: _this3.onClick,
        onKeyDown: _this3.deleteOrInsertAfterWrapper,
        tabIndex: "0",
        "aria-label": blockLabel,
        childHandledEvents: ['onDragStart', 'onMouseDown'],
        ...wrapperProps
      },
      shouldShowInsertionPoint && createElement(BlockInsertionPoint, {
        clientId: clientId,
        rootClientId: rootClientId
      }), createElement(BlockDropZone, {
        index: order,
        clientId: clientId,
        rootClientId: rootClientId
      }), shouldRenderMovers && createElement(BlockMover, {
        clientIds: clientId,
        blockElementId: blockElementId,
        isFirst: isFirst,
        isLast: isLast,
        isHidden: !(isHovered || isSelected) || hoverArea !== 'left',
        isDraggable: isDraggable !== false && !isPartOfMultiSelection && isMovable,
        onDragStart: _this3.onDragStart,
        onDragEnd: _this3.onDragEnd
      }), isFirstMultiSelected && createElement(BlockMultiControls, {
        rootClientId: rootClientId
      }), createElement("div", {
        className: "editor-block-list__block-edit"
      }, shouldShowBreadcrumb && createElement(BlockBreadcrumb, {
        clientId: clientId,
        isHidden: !(isHovered || isSelected) || hoverArea !== 'left'
      }),
      (shouldShowContextualToolbar || _this3.isForcingContextualToolbar) && createElement(BlockContextualToolbar
      // If the toolbar is being shown because of being forced
      // it should focus the toolbar right after the mount.
      , {
        focusOnMount: _this3.isForcingContextualToolbar
      }),
      !shouldShowContextualToolbar && isSelected && !hasFixedToolbar && !isEmptyDefaultBlock && createElement(KeyboardShortcuts, {
        bindGlobal: true,
        eventName: "keydown",
        shortcuts: {
          'alt+f10': _this3.forceFocusedContextualToolbar
        }
      }),
      createElement(IgnoreNestedEvents, {
        	ref: _this3.bindBlockNode,
        	onDragStart: _this3.preventDrag,
        	onMouseDown: _this3.onPointerDown,
        	"data-block": clientId
      	},
      	createElement(BlockCrashBoundary, {
        	onError: _this3.onBlockError
      	},
      	isValid && blockEdit, isValid && mode === 'html' && createElement(BlockHtml, {
        	clientId: clientId
      	}), !isValid && [
        	createElement(BlockInvalidWarning, {
	          key: "invalid-warning",
	          clientId: clientId
	        }),
	        createElement("div", {
	          key: "invalid-preview"
	        }, getSaveElement(blockType, attributes))
	      ]),
        shouldShowMobileToolbar && createElement(BlockMobileToolbar, {
          clientId: clientId
        }), !!error && createElement(BlockCrashWarning, null))), showEmptyBlockSideInserter && createElement(Fragment, null, createElement("div", {
          className: "editor-block-list__side-inserter"
        }, createElement(InserterWithShortcuts, {
          clientId: clientId,
          rootClientId: rootClientId,
          onToggle: _this3.selectOnOpen
        })), createElement("div", {
          className: "editor-block-list__empty-block-inserter"
        }, createElement(Inserter, {
          position: "top right",
          onToggle: _this3.selectOnOpen
      }))));

      return el('div', {
      		className: classnames('rb-editor-column', columnClass),
      	},
      	retBlocks
      )
      /* eslint-enable jsx-a11y/no-static-element-interactions, jsx-a11y/onclick-has-role, jsx-a11y/click-events-have-key-events */
    });
	}
}

const applyWithSelect = withSelect(
	( select, { clientId, rootClientId, isLargeViewport } ) => {
		const {
			isBlockSelected,
			isAncestorMultiSelected,
			isBlockMultiSelected,
			isFirstMultiSelectedBlock,
			isMultiSelecting,
			isTyping,
			isCaretWithinFormattedText,
			getBlockIndex,
			getBlockMode,
			isSelectionEnabled,
			getSelectedBlocksInitialCaretPosition,
			getEditorSettings,
			hasSelectedInnerBlock,
			getTemplateLock,
			__unstableGetBlockWithoutInnerBlocks,
		} = select( 'core/editor' );
		const block = __unstableGetBlockWithoutInnerBlocks( clientId );
		const isSelected = isBlockSelected( clientId );
		const { hasFixedToolbar, focusMode } = getEditorSettings();
		const templateLock = getTemplateLock( rootClientId );
		const isParentOfSelectedBlock = hasSelectedInnerBlock( clientId, true );

		// The fallback to `{}` is a temporary fix.
		// This function should never be called when a block is not present in the state.
		// It happens now because the order in withSelect rendering is not correct.
		const { name, attributes, isValid } = block || {};

		return {
			isPartOfMultiSelection:
				isBlockMultiSelected( clientId ) || isAncestorMultiSelected( clientId ),
			isFirstMultiSelected: isFirstMultiSelectedBlock( clientId ),
			isMultiSelecting: isMultiSelecting(),
			// We only care about this prop when the block is selected
			// Thus to avoid unnecessary rerenders we avoid updating the prop if the block is not selected.
			isTypingWithinBlock:
				( isSelected || isParentOfSelectedBlock ) && isTyping(),
			isCaretWithinFormattedText: isCaretWithinFormattedText(),
			order: getBlockIndex( clientId, rootClientId ),
			mode: getBlockMode( clientId ),
			isSelectionEnabled: isSelectionEnabled(),
			initialPosition: getSelectedBlocksInitialCaretPosition(),
			isEmptyDefaultBlock:
				name && isUnmodifiedDefaultBlock( { name, attributes } ),
			isMovable: 'all' !== templateLock,
			isLocked: !! templateLock,
			isFocusMode: focusMode && isLargeViewport,
			hasFixedToolbar: hasFixedToolbar && isLargeViewport,

			// Users of the editor.BlockListBlock filter used to be able to access the block prop
			// Ideally these blocks would rely on the clientId prop only.
			// This is kept for backward compatibility reasons.
			block,

			name,
			attributes,
			isValid,
			isSelected,
			isParentOfSelectedBlock,
		};
	}
);

const applyWithDispatch = withDispatch( ( dispatch, ownProps, { select } ) => {
	const { getBlockSelectionStart } = select( 'core/editor' );
	const {
		updateBlockAttributes,
		selectBlock,
		multiSelect,
		insertBlocks,
		insertDefaultBlock,
		removeBlock,
		mergeBlocks,
		replaceBlocks,
		editPost,
		toggleSelection,
	} = dispatch( 'core/editor' );

	return {
		onChange( clientId, attributes ) {
			updateBlockAttributes( clientId, attributes );
		},
		onSelect( clientId = ownProps.clientId, initialPosition ) {
			selectBlock( clientId, initialPosition );
		},
		onInsertBlocks( blocks, index ) {
			const { rootClientId } = ownProps;
			insertBlocks( blocks, index, rootClientId );
		},
		onInsertDefaultBlockAfter() {
			const { order, rootClientId } = ownProps;
			insertDefaultBlock( {}, rootClientId, order + 1 );
		},
		onRemove( clientId ) {
			removeBlock( clientId );
		},
		onMerge( forward ) {
			const { clientId } = ownProps;
			const {
				getPreviousBlockClientId,
				getNextBlockClientId,
			} = select( 'core/editor' );

			if ( forward ) {
				const nextBlockClientId = getNextBlockClientId( clientId );
				if ( nextBlockClientId ) {
					mergeBlocks( clientId, nextBlockClientId );
				}
			} else {
				const previousBlockClientId = getPreviousBlockClientId( clientId );
				if ( previousBlockClientId ) {
					mergeBlocks( previousBlockClientId, clientId );
				}
			}
		},
		onReplace( blocks ) {
			replaceBlocks( [ ownProps.clientId ], blocks );
		},
		onMetaChange( meta ) {
			editPost( { meta } );
		},
		onShiftSelection() {
			if ( ! ownProps.isSelectionEnabled ) {
				return;
			}

			if ( getBlockSelectionStart() ) {
				multiSelect( getBlockSelectionStart(), ownProps.clientId );
			} else {
				selectBlock( ownProps.clientId );
			}
		},
		toggleSelection( selectionEnabled ) {
			toggleSelection( selectionEnabled );
		},
	};
} );

export default compose([
	withViewportMatch( { isLargeViewport: 'medium' } ),
	applyWithSelect,
	applyWithDispatch,
	withFilters( 'editor.BlockListBlock' )
])( BlockListBlock );
