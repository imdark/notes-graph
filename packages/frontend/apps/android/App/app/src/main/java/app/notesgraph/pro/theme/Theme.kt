package app.notesgraph.pro.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

object NotesGraphTheme {
    val colors: NotesGraphColorScheme
        @ReadOnlyComposable
        @Composable
        get() = LocalNotesGraphColors.current

    val typography: NotesGraphTypography
        @ReadOnlyComposable
        @Composable
        get() = LocalNotesGraphTypography.current

    /** Whether the resolved mode is dark - use instead of isSystemInDarkTheme(). */
    val isDark: Boolean
        @ReadOnlyComposable
        @Composable
        get() = LocalNotesGraphDark.current
}

private val LocalNotesGraphDark = staticCompositionLocalOf { false }

@Composable
fun NotesGraphTheme(
    mode: ThemeMode = ThemeMode.System,
    content: @Composable () -> Unit
) {
    val dark = when (mode) {
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
        ThemeMode.System -> isSystemInDarkTheme()
    }
    val colors = if (dark) notesgraphDarkScheme else notesgraphLightScheme

    CompositionLocalProvider(
        LocalNotesGraphColors provides colors,
        LocalNotesGraphDark provides dark,
    ) {
        // Material components (buttons, text fields, surfaces) read the
        // Material scheme, so it carries our colours rather than its purple.
        MaterialTheme(colorScheme = if (dark) materialDarkScheme else materialLightScheme) {
            content()
        }
    }
}

private val materialLightScheme: ColorScheme = with(NotesGraphColorTokens) {
    lightColorScheme(
        primary = NotesGraph600,
        onPrimary = BaseWhite,
        primaryContainer = NotesGraph25,
        onPrimaryContainer = NotesGraph900,
        secondary = Grey700,
        onSecondary = BaseWhite,
        secondaryContainer = Grey100,
        onSecondaryContainer = Grey900,
        background = BaseWhite,
        onBackground = Grey900,
        surface = BaseWhite,
        onSurface = Grey900,
        surfaceVariant = Grey100,
        onSurfaceVariant = Grey600,
        surfaceTint = BaseWhite,
        inverseSurface = Grey900,
        inverseOnSurface = Grey100,
        inversePrimary = NotesGraph300,
        outline = Grey300,
        outlineVariant = Grey200,
        error = Red600,
        onError = BaseWhite,
    )
}

private val materialDarkScheme: ColorScheme = with(NotesGraphColorTokens) {
    darkColorScheme(
        primary = NotesGraph500,
        onPrimary = BaseWhite,
        primaryContainer = NotesGraph900,
        onPrimaryContainer = NotesGraph50,
        secondary = Grey400,
        onSecondary = Grey950,
        secondaryContainer = Grey800,
        onSecondaryContainer = Grey100,
        background = Grey950,
        onBackground = Grey200,
        surface = Grey950,
        onSurface = Grey200,
        surfaceVariant = Grey900,
        onSurfaceVariant = Grey500,
        surfaceTint = Grey950,
        inverseSurface = Grey200,
        inverseOnSurface = Grey900,
        inversePrimary = NotesGraph700,
        outline = Grey700,
        outlineVariant = Grey800,
        error = Red400,
        onError = Grey950,
    )
}

enum class ThemeMode(name: String) {
    Light("light"),
    Dark("dark"),
    System("system");

    fun of(name: String) = when (name) {
        "light" -> Light
        "dark" -> Dark
        else -> System
    }
}
