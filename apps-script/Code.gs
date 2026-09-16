/**
 * Inserts Drive-hosted images into Google Docs without public URLs.
 *
 * Called via Apps Script API (gws script scripts run).
 */

/**
 * @param {string} documentId
 * @param {string} fileId Drive file ID (private OK)
 * @param {number} index Docs body index
 * @param {Object} opts optional widthPt, heightPt, align (left|center|right)
 */
function insertImageFromDrive(documentId, fileId, index, opts) {
  opts = opts || {};
  var blob = DriveApp.getFileById(fileId).getBlob();
  var body = DocumentApp.openById(documentId).getBody();
  var image = body.insertInlineImage(index, blob);

  if (opts.widthPt) {
    image.setWidth(opts.widthPt);
  }
  if (opts.heightPt) {
    image.setHeight(opts.heightPt);
  } else if (opts.widthPt) {
    image.setWidth(opts.widthPt);
  }

  if (opts.align) {
    var parent = image.getParent();
    if (parent.getType() === DocumentApp.ElementType.PARAGRAPH) {
      var alignment = DocumentApp.HorizontalAlignment.LEFT;
      if (opts.align === "center") {
        alignment = DocumentApp.HorizontalAlignment.CENTER;
      } else if (opts.align === "right") {
        alignment = DocumentApp.HorizontalAlignment.RIGHT;
      }
      parent.asParagraph().setAlignment(alignment);
    }
  }

  return index + 1;
}
