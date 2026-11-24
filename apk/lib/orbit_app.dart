import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'dart:convert';
import 'dart:ui' show FlutterView;

import 'chat_picker.dart';
import 'incoming_call.dart';

const _device = MethodChannel('com.orbit.messenger/device');

class OrbitApp extends StatelessWidget {
  const OrbitApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Orbit',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      brightness: Brightness.dark,
      colorSchemeSeed: const Color(0xff9076ef),
      scaffoldBackgroundColor: const Color(0xff08080c),
      useMaterial3: true,
    ),
    themeMode: ThemeMode.dark,
    home: const OrbitHome(),
  );
}

enum _Gate { loading, setup, unlock, verifyChange, replace, open }

class OrbitHome extends StatefulWidget {
  const OrbitHome({super.key});

  @override
  State<OrbitHome> createState() => _OrbitHomeState();
}

class _OrbitHomeState extends State<OrbitHome> with WidgetsBindingObserver {
  final _pin = TextEditingController();
  final _focus = FocusNode();
  _Gate _gate = _Gate.loading;
  bool _hasStartedWeb = false;
  bool _biometrics = false;
  bool _busy = false;
  String? _firstPin;
  String? _error;
  Map<dynamic, dynamic>? _incoming;
  BuildContext? _pickerContext;
  FlutterView? _window;
  int? _lastVisibleHeight;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _device.setMethodCallHandler(_handleDeviceEvent);
    _readDeviceState();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _window = View.of(context);
  }

  @override
  void didChangeMetrics() => _syncKeyboardViewport();

  void _syncKeyboardViewport({bool force = false}) {
    final view = _window;
    if (!_hasStartedWeb || view == null) return;
    final inset = view.viewInsets.bottom;
    final height = inset > 0
        ? ((view.physicalSize.height - inset - view.viewPadding.top) /
                  view.devicePixelRatio)
              .floor()
        : 0;
    if (!force && _lastVisibleHeight == height) return;
    _lastVisibleHeight = height;
    _device.invokeMethod<void>('keyboardViewport', height);
  }

  Future<void> _readDeviceState() async {
    try {
      final state = await _device.invokeMapMethod<String, bool>('state');
      if (!mounted) return;
      setState(() {
        _biometrics = state?['biometrics'] ?? false;
        _gate = state?['hasPin'] == true ? _Gate.unlock : _Gate.setup;
        _error = null;
      });
    } on PlatformException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  Future<void> _handleDeviceEvent(MethodCall call) async {
    if (!mounted) return;
    if (call.method == 'locked') {
      _dismissPicker();
      _show(_Gate.unlock);
    }
    if (call.method == 'changePin') _show(_Gate.verifyChange);
    if (call.method == 'incomingCall') {
      _dismissPicker();
      setState(() => _incoming = call.arguments as Map);
    }
    if (call.method == 'incomingCallCleared') setState(() => _incoming = null);
    if (call.method == 'openChatPicker' &&
        _gate == _Gate.open &&
        _incoming == null &&
        _pickerContext == null) {
      final model = Map<String, dynamic>.from(
        jsonDecode(call.arguments as String) as Map,
      );
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        useSafeArea: true,
        builder: (sheet) {
          _pickerContext = sheet;
          return OrbitChatPicker(
            model: model,
            onAction: (action, id) {
              final payload = jsonEncode({
                'token': model['token'],
                'action': action,
                'id': id,
              });
              _device.invokeMethod<bool>('pickerAction', payload);
            },
          );
        },
      );
      _pickerContext = null;
      await _device.invokeMethod<bool>(
        'pickerAction',
        jsonEncode({'token': model['token'], 'action': 'closed'}),
      );
    }
  }

  void _dismissPicker() {
    final sheet = _pickerContext;
    if (sheet != null &&
        sheet.mounted &&
        ModalRoute.of(sheet)?.isCurrent == true)
      Navigator.pop(sheet);
  }

  void _show(_Gate gate) {
    _pin.clear();
    _focus.unfocus();
    setState(() {
      _firstPin = null;
      _error = null;
      _gate = gate;
      if (gate == _Gate.open) _hasStartedWeb = true;
    });
  }

  Future<void> _submit() async {
    final pin = _pin.text;
    if (_busy || pin.length != 4) return;
    final startingGate = _gate;
    if (_gate == _Gate.setup || _gate == _Gate.replace) {
      if (_firstPin == null) {
        setState(() {
          _firstPin = pin;
          _error = null;
        });
        _pin.clear();
        _focus.requestFocus();
        return;
      }
      if (_firstPin != pin) {
        _show(_gate);
        setState(() => _error = 'PINs did not match. Try again.');
        _focus.requestFocus();
        return;
      }
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    _pin.clear();
    try {
      if (startingGate == _Gate.setup || startingGate == _Gate.replace) {
        await _device.invokeMethod<void>('createPin', pin);
        if (mounted && _gate == startingGate) _show(_Gate.open);
      } else {
        final error = await _device.invokeMethod<String>('checkPin', pin);
        if (!mounted || _gate != startingGate) return;
        if (error == null) {
          _show(
            startingGate == _Gate.verifyChange ? _Gate.replace : _Gate.open,
          );
        } else {
          setState(() => _error = error);
        }
      }
    } on PlatformException catch (error) {
      if (mounted && _gate == startingGate) {
        setState(() {
          _firstPin = null;
          _error = error.message;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _useBiometrics() async {
    if (_busy) return;
    final startingGate = _gate;
    _focus.unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final ok = await _device.invokeMethod<bool>('biometrics');
      if (ok == true && mounted && _gate == startingGate) {
        _show(startingGate == _Gate.verifyChange ? _Gate.replace : _Gate.open);
      }
    } on PlatformException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancelChange() async {
    final canOpen = await _device.invokeMethod<bool>('cancelPinChange');
    if (mounted) _show(canOpen == true ? _Gate.open : _Gate.unlock);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _device.setMethodCallHandler(null);
    _pin.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: false,
    onPopInvokedWithResult: (popped, _) async {
      if (popped) return;
      if (_gate == _Gate.verifyChange || _gate == _Gate.replace) {
        await _cancelChange();
      } else if (_gate != _Gate.open ||
          await _device.invokeMethod<bool>('back') != true) {
        await SystemNavigator.pop();
      }
    },
    child: Scaffold(
      resizeToAvoidBottomInset: _gate != _Gate.open,
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (_hasStartedWeb)
              AndroidView(
                viewType: 'orbit-messaging',
                onPlatformViewCreated: (_) =>
                    _syncKeyboardViewport(force: true),
              ),
            if (_gate != _Gate.open)
              ColoredBox(
                color: Theme.of(context).scaffoldBackgroundColor,
                child: Center(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 24,
                      vertical: 20,
                    ),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 340),
                      child: _buildGate(context),
                    ),
                  ),
                ),
              ),
            if (_incoming case final data?)
              OrbitIncomingCall(
                title: data['title'] as String,
                full: data['full'] == true,
                onAction: (action) => _device.invokeMethod<bool>('callAction', {
                  'id': data['id'],
                  'action': action,
                }),
              ),
          ],
        ),
      ),
    ),
  );

  Widget _buildGate(BuildContext context) {
    final creating = _gate == _Gate.setup || _gate == _Gate.replace;
    final heading = switch (_gate) {
      _Gate.setup => 'Set an Orbit PIN',
      _Gate.verifyChange => 'Verify to change your PIN',
      _Gate.replace => 'Choose a new PIN',
      _Gate.unlock => 'Unlock Orbit',
      _ => 'Orbit',
    };
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(
          Icons.lock_outline_rounded,
          size: 36,
          color: Color(0xffb8a3ff),
        ),
        const SizedBox(height: 18),
        Text(
          heading,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 12),
        if (_gate == _Gate.loading) ...[
          if (_error == null) const Center(child: CircularProgressIndicator()),
          if (_error != null) ...[
            Text(_error!),
            TextButton(onPressed: _readDeviceState, child: const Text('Retry')),
          ],
        ] else ...[
          if (creating)
            const Text(
              'Choose four digits to protect Orbit on this phone.',
              textAlign: TextAlign.center,
            ),
          const SizedBox(height: 12),
          TextField(
            controller: _pin,
            focusNode: _focus,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.done,
            obscureText: true,
            enableSuggestions: false,
            enableInteractiveSelection: false,
            autocorrect: false,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(4),
            ],
            decoration: InputDecoration(
              labelText: _firstPin != null ? 'Confirm PIN' : '4-digit PIN',
              errorText: _error,
              errorMaxLines: 3,
              border: const OutlineInputBorder(),
            ),
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: Text(creating ? 'Continue' : 'Unlock'),
          ),
          if (!creating && _biometrics)
            OutlinedButton.icon(
              onPressed: _busy ? null : _useBiometrics,
              icon: const Icon(Icons.fingerprint),
              label: const Text('Use biometrics'),
            ),
          if (_gate == _Gate.verifyChange || _gate == _Gate.replace)
            TextButton(
              onPressed: _busy ? null : _cancelChange,
              child: const Text('Cancel'),
            ),
        ],
      ],
    );
  }
}
