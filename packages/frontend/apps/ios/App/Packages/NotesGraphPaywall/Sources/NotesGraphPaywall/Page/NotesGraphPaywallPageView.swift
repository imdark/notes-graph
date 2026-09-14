//
//  NotesGraphPaywallPageView.swift
//  NotesGraphPaywall
//
//  Created by qaq on 9/18/25.
//

import NotesGraphResources
import SwiftUI

struct NotesGraphPaywallPageView: View {
  @StateObject var viewModel = ViewModel()

  @Environment(\.dismiss) var dismiss

  @State private var presentAnimation = false
  @State private var showCloseButton = false

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        CategorySelectionView(
          selectedTab: viewModel.category,
          onSelect: viewModel.select(category:)
        )
        Spacer()
        Button {
          viewModel.dismiss()
        } label: {
          NotesGraphIcons.close.image
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: 24, height: 24)
            .foregroundStyle(.primary)
        }
        .buttonStyle(.plain)
        .foregroundColor(NotesGraphColors.textSecondary.color)
        .opacity(showCloseButton ? 1 : 0)
        .disabled(!showCloseButton)
        .animation(.spring, value: showCloseButton)
      }
      ZStack(alignment: .topLeading) {
        Spacer()
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        content
          .frame(maxWidth: .infinity)
          .transition(
            .opacity
              .combined(with: .scale(
                scale: 0.95,
                anchor: .init(x: 0.5, y: 0)
              ))
          )
      }
      .animation(.spring.speed(2), value: viewModel.category)

      PurchaseFooterView(viewModel: viewModel)
        .animation(.spring.speed(2), value: viewModel.selectedPackageIdentifier)
    }
    .padding()
    .opacity(presentAnimation ? 1 : 0)
    .scaleEffect(presentAnimation ? 1 : 0.95, anchor: .top)
    .animation(.spring, value: presentAnimation)
    .onAppear {
      presentAnimation = true
      DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
        showCloseButton = true
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(
      NotesGraphColors.layerBackgroundSecondary.color
        .ignoresSafeArea()
    )
  }

  @ViewBuilder
  var content: some View {
    switch viewModel.category {
    case .pro:
      SKUnitProDetailView(viewModel: viewModel)
    case .ai:
      SKUnitIntelligentDetailView(viewModel: viewModel)
    }
  }
}

#Preview {
  struct PreviewWrapper: View {
    @StateObject var viewModel = ViewModel()
    var body: some View {
      NotesGraphPaywallPageView(viewModel: viewModel)
    }
  }
  return PreviewWrapper()
}
