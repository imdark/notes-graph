package app.notesgraph.pro.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable

object NotesGraphTheme {
    val colors: NotesGraphColorScheme
        @ReadOnlyComposable
        @Composable
        get() = LocalNotesGraphColors.current

    val typography: NotesGraphTypography
        @ReadOnlyComposable
        @Composable
        get() = LocalNotesGraphTypography.current
}

@Composable
fun NotesGraphTheme(
    mode: ThemeMode = ThemeMode.System,
    content: @Composable () -> Unit
) {
    val colors = when (mode) {
        ThemeMode.Light -> notesgraphLightScheme
        ThemeMode.Dark -> notesgraphDarkScheme
        ThemeMode.System -> if (isSystemInDarkTheme()) notesgraphDarkScheme else notesgraphLightScheme
    }

    CompositionLocalProvider(LocalNotesGraphColors provides colors) {
        // Material components (buttons, text fields, surfaces) read
        // MaterialTheme, so it has to follow the mode too - left at its
        // default it is always light.
        MaterialTheme(colorScheme = materialScheme(colors, dark = colors == notesgraphDarkScheme)) {
            content()
        }
    }
}

private fun materialScheme(c: NotesGraphColorScheme, dark: Boolean): ColorScheme {
    val t = NotesGraphColorTokens
    return if (dark) {
        darkColorScheme(
            primary = t.NotesGraph500,
            onPrimary = t.BaseWhite,
            background = c.backgroundPrimary,
            onBackground = c.textPrimary,
            surface = c.backgroundPrimary,
            onSurface = c.textPrimary,
            surfaceVariant = c.backgroundSecondary,
            onSurfaceVariant = c.textSecondary,
            surfaceTint = c.backgroundPrimary,
            inverseSurface = t.Grey200,
            inverseOnSurface = t.Grey900,
            outline = t.Grey700,
            outlineVariant = t.Grey800,
            error = t.Red400,
        )
    } else {
        lightColorScheme(
            primary = t.NotesGraph600,
            onPrimary = t.BaseWhite,
            background = c.backgroundPrimary,
            onBackground = c.textPrimary,
            surface = c.backgroundPrimary,
            onSurface = c.textPrimary,
            surfaceVariant = c.backgroundSecondary,
            onSurfaceVariant = c.textSecondary,
            surfaceTint = c.backgroundPrimary,
            inverseSurface = t.Grey900,
            inverseOnSurface = t.Grey100,
            outline = t.Grey300,
            outlineVariant = t.Grey200,
            error = t.Red600,
        )
    }
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