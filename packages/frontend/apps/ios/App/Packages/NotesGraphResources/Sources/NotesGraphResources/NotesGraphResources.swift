// The Swift Programming Language
// https://docs.swift.org/swift-book

import SwiftUI
import UIKit

public enum NotesGraphColors: String, CaseIterable {
  case buttonPrimary = "notesgraph.button.primary"
  case iconActivated = "notesgraph.icon.activated"
  case iconPrimary = "notesgraph.icon.primary"
  case layerBackgroundPrimary = "notesgraph.layer.background.primary"
  case layerBackgroundSecondary = "notesgraph.layer.background.secondary"
  case layerBorder = "notesgraph.layer.border"
  case layerPureWhite = "notesgraph.layer.pureWhite"
  case textEmphasis = "notesgraph.text.emphasis"
  case textLink = "notesgraph.text.link"
  case textListDotAndNumber = "notesgraph.text.listDotAndNumber"
  case textPlaceholder = "notesgraph.text.placeholder"
  case textPrimary = "notesgraph.text.primary"
  case textPureWhite = "notesgraph.text.pureWhite"
  case textSecondary = "notesgraph.text.secondary"
  case textTertiary = "notesgraph.text.tertiary"

  @available(iOS 13.0, *)
  public var color: Color {
    Color(rawValue, bundle: .module)
  }

  public var uiColor: UIColor {
    UIColor(named: rawValue, in: .module, compatibleWith: nil) ?? .clear
  }
}

public enum NotesGraphIcons: String, CaseIterable {
  case arrowDown = "ArrowDown"
  case arrowUpBig = "ArrowUpBig"
  case box = "Box"
  case broom = "Broom"
  case bubble = "Bubble"
  case calendar = "Calendar"
  case camera = "Camera"
  case checkCircle = "CheckCircle"
  case close = "Close"
  case image = "Image"
  case more = "More"
  case page = "Page"
  case plus = "Plus"
  case settings = "Settings"
  case think = "Think"
  case tools = "Tools"
  case upload = "Upload"
  case web = "Web"

  @available(iOS 13.0, *)
  public var image: Image {
    Image(rawValue, bundle: .module)
  }

  @available(iOS 13.0, *)
  public var uiImage: UIImage {
    UIImage(named: rawValue, in: .module, with: .none) ?? UIImage()
  }
}
