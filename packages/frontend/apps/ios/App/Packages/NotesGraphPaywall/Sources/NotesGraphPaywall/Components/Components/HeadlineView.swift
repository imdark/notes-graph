//
//  HeadlineView.swift
//  NotesGraphPaywall
//
//  Created by qaq on 9/18/25.
//

import NotesGraphResources
import SwiftUI

struct HeadlineView: View {
  @StateObject var viewModel: ViewModel
  var body: some View {
    VStack(spacing: 8) {
      Text(viewModel.selectedUnit.primaryText)
        .font(.system(size: 24, weight: .semibold))
        .contentTransition(.numericText())
        .animation(.spring.speed(2), value: viewModel.category)
        .padding(.top, 8)

      Text(viewModel.selectedUnit.secondaryText)
        .font(.system(size: 16))
        .foregroundStyle(NotesGraphColors.textSecondary.color)
        .contentTransition(.numericText())
        .animation(.spring.speed(2), value: viewModel.category)
    }
  }
}
