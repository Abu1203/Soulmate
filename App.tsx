// ============================================================
// Soulmate — 纯 Soul 陪伴模式
// ============================================================
import React, { useMemo } from 'react';
import { StatusBar, LogBox } from 'react-native';
import { NavigationContainer, DrawerActions } from '@react-navigation/native';
import { createDrawerNavigator, useDrawerStatus } from '@react-navigation/drawer';
import { createStackNavigator } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { AgentSoulProvider } from './src/contexts/AgentSoulContext';
import AgentSoulChatScreen from './src/screens/AgentSoulChatScreen';
import AgentSoulSettingsScreen from './src/screens/AgentSoulSettingsScreen';
import AgentSoulSidebar from './src/screens/AgentSoulSidebar';
import ApiKeyScreen from './src/screens/ApiKeyScreen';
import ThemeScreen from './src/screens/ThemeScreen';
import MomentsFeedScreen from './src/screens/MomentsFeedScreen';
import MomentsPublishScreen from './src/screens/MomentsPublishScreen';
import TransferScreen from './src/screens/TransferScreen';
import CreateGroupScreen from './src/screens/CreateGroupScreen';
import GroupChatScreen from './src/screens/GroupChatScreen';
import GameGuessNumberScreen from './src/screens/GameGuessNumberScreen';
import GameIdiomChainScreen from './src/screens/GameIdiomChainScreen';
import GameTwentyQuestionsScreen from './src/screens/GameTwentyQuestionsScreen';
import GameGomokuScreen from './src/screens/GameGomokuScreen';
import PomodoroScreen from './src/screens/PomodoroScreen';
import ErrorBoundary from './src/components/ErrorBoundary';
import AppDialogHost from './src/components/AppDialogHost';

LogBox.ignoreLogs([
  'Non-serializable values',
  'VirtualizedLists should never be nested',
]);

const Stack = createStackNavigator();
const Drawer = createDrawerNavigator();

function DrawerContent(props:any) {
  // A hidden drawer must not sort/render every role on each streamed token.
  const status=useDrawerStatus();
  if(status!=='open')return null;
  return (
        <AgentSoulSidebar
          onApiKeySettings={() => { props.navigation.dispatch(DrawerActions.closeDrawer()); props.navigation.navigate('ApiKeySettings'); }}
          onMoments={() => { props.navigation.dispatch(DrawerActions.closeDrawer()); props.navigation.navigate('MomentsFeed'); }}
          onCloseDrawer={() => { try { props.navigation.dispatch(DrawerActions.closeDrawer()); } catch {} }}
          onGroupChat={() => { props.navigation.dispatch(DrawerActions.closeDrawer()); props.navigation.navigate('CreateGroup'); }}
          onOpenGroupChat={(convId) => {
            try { props.navigation.dispatch(DrawerActions.closeDrawer()); } catch {}
            // ✅ 直接导航到群聊，不经过 AgentSoulChatScreen
            props.navigation.navigate('GroupChat', { convId });
          }}
        />
  );
}
function SoulDrawer() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: { width: '82%', backgroundColor: '#FAFAFA' },
        overlayColor: 'rgba(0,0,0,0.4)',
        swipeEnabled: false,
      }}>
      <Drawer.Screen name="AgentSoulChat" component={AgentSoulChatScreen} />
    </Drawer.Navigator>
  );
}

function RootNavigator() {
  const { colors, isDark } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: colors.background },
        presentation: 'card',
      }}>
      <Stack.Screen name="Main" component={SoulDrawer} />

      <Stack.Screen
        name="AgentSoulSettings"
        component={AgentSoulSettingsScreen}
        options={{
          headerShown: false,
          presentation: 'card',
        }}
      />

      <Stack.Screen
        name="Theme"
        component={ThemeScreen}
        options={{
          headerShown: false,
          presentation: 'card',
        }}
      />

      <Stack.Screen
        name="ApiKeySettings"
        component={ApiKeyScreen}
        options={{
          headerShown: true,
          title: 'AI 服务设置',
          headerBackTitle: '返回',
          headerStyle: {
            backgroundColor: colors.background,
            shadowColor: 'transparent',
            elevation: 0,
          },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            fontSize: 17,
            fontWeight: '600',
            color: colors.text,
          },
        }}
      />

      <Stack.Screen
        name="MomentsFeed"
        component={MomentsFeedScreen}
        options={{ headerShown: false, presentation: 'card' }}
      />

      <Stack.Screen
        name="MomentsPublish"
        component={MomentsPublishScreen}
        options={{ headerShown: false, presentation: 'card' }}
      />

      <Stack.Screen
        name="Transfer"
        component={TransferScreen}
        options={{ headerShown: false, presentation: 'card' }}
      />
      <Stack.Screen
        name="CreateGroup"
        component={CreateGroupScreen}
        options={{ headerShown: false, presentation: 'card' }}
      />
      <Stack.Screen
        name="GroupChat"
        component={GroupChatScreen}
        options={{ headerShown: false, presentation: 'card' }}
      />
      <Stack.Screen
        name="GameGuessNumber"
        component={GameGuessNumberScreen}
        options={{ headerShown: false, presentation: 'card' }}
      />
      <Stack.Screen
        name="GameIdiomChain"
        component={GameIdiomChainScreen}
        options={{ headerShown: false, presentation: 'card' }}
      />
      <Stack.Screen
        name="GameTwentyQuestions"
        component={GameTwentyQuestionsScreen}
        options={{ headerShown: false, presentation: 'card' }}
      />
      <Stack.Screen
        name="GameGomoku"
        component={GameGomokuScreen}
        options={{ headerShown: false, presentation: 'card' }}
      />
      <Stack.Screen
        name="Pomodoro"
        component={PomodoroScreen}
        options={{ headerShown: false, presentation: 'card' }}
      />
    </Stack.Navigator>
  );
}

function AppContent() {
  const { colors, isDark } = useTheme();

  const navTheme = useMemo(() => ({
    dark: isDark,
    colors: {
      primary: colors.primary,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.separator,
      notification: colors.error,
    },
    fonts: {
      regular: { fontFamily: 'System', fontWeight: '400' as const },
      medium: { fontFamily: 'System', fontWeight: '500' as const },
      bold: { fontFamily: 'System', fontWeight: '700' as const },
      heavy: { fontFamily: 'System', fontWeight: '800' as const },
    },
  }), [isDark, colors.primary, colors.background, colors.card, colors.text, colors.separator, colors.error]);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <NavigationContainer theme={navTheme}>
          <StatusBar
            barStyle={isDark ? 'light-content' : 'dark-content'}
            backgroundColor="transparent"
            translucent={true}
          />
          <RootNavigator />
        </NavigationContainer>
        <AppDialogHost />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
      <AgentSoulProvider>
          <AppContent />
      </AgentSoulProvider>
    </ThemeProvider>
    </ErrorBoundary>
  );
}
