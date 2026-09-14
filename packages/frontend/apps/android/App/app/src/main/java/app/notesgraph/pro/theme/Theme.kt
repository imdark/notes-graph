package app.notesgraph.pro.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
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
        MaterialTheme {
            content()
        }
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