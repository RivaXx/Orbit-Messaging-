import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';

class OrbitChatPicker extends StatefulWidget {
  const OrbitChatPicker({
    super.key,
    required this.model,
    required this.onAction,
  });

  final Map<String, dynamic> model;
  final void Function(String action, String id) onAction;

  @override
  State<OrbitChatPicker> createState() => _OrbitChatPickerState();
}

class _OrbitChatPickerState extends State<OrbitChatPicker> {
  static Future<String?>? _keyRequest;
  final _input = TextEditingController();
  final _images = <String, Uint8List>{};
  final _client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
  late String _tab;
  String _stickerSection = 'My Stickers';
  late List<String> _recent;
  int _category = 0, _queryVersion = 0;
  List<Map<String, dynamic>> _gifs = [];
  bool _loading = false;
  String? _error;
  Timer? _debounce;

  List<Map<String, dynamic>> _maps(String field) =>
      (widget.model[field] as List)
          .map((item) => Map<String, dynamic>.from(item as Map))
          .toList();
  List<String> _strings(String field) =>
      (widget.model[field] as List).cast<String>();
  String? _gifKey;
  bool get _isLight => widget.model['light'] == true;

  @override
  void initState() {
    super.initState();
    _tab = widget.model['tab'] as String;
    _recent = List.of(_strings('recent'));
    if (_tab == 'gif') _searchGiphy();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _input.dispose();
    _client.close(force: true);
    super.dispose();
  }

  void _select(String tab) {
    if (_tab == tab) return;
    FocusScope.of(context).unfocus();
    _debounce?.cancel();
    _queryVersion++;
    _input.clear();
    setState(() {
      _tab = tab;
      _error = null;
      _loading = false;
    });
    if (tab == 'gif') _searchGiphy();
  }

  static Future<String?> _loadGifKey() async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    try {
      final request = await client.getUrl(
        Uri.https('orbit-messaging.vercel.app', '/api/gif-config'),
      );
      final response = await request.close().timeout(
        const Duration(seconds: 2),
      );
      if (response.statusCode != 200) return null;
      final result = jsonDecode(
        await response
            .transform(utf8.decoder)
            .join()
            .timeout(const Duration(seconds: 2)),
      );
      final key = result['key'];
      return key is String && RegExp(r'^[A-Za-z0-9]{16,80}$').hasMatch(key)
          ? key
          : null;
    } catch (_) {
      return null;
    } finally {
      client.close(force: true);
    }
  }

  Future<void> _searchGiphy() async {
    final key = await (_keyRequest ??= _loadGifKey());
    if (key == null || !mounted || _tab != 'gif') return;
    _gifKey = key;
    final query = _input.text.trim(), generation = ++_queryVersion;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final url = Uri.https(
        'api.giphy.com',
        query.isEmpty ? '/v1/gifs/trending' : '/v1/gifs/search',
        {
          'api_key': key,
          'limit': '24',
          'rating': 'pg',
          if (query.isNotEmpty)
            'q': query.substring(0, math.min(query.length, 50)),
        },
      );
      final request = await _client
          .getUrl(url)
          .timeout(const Duration(seconds: 7));
      final response = await request.close().timeout(
        const Duration(seconds: 7),
      );
      if (response.statusCode != 200)
        throw const HttpException('GIPHY search failed.');
      final decoded =
          jsonDecode(
                await response
                    .transform(utf8.decoder)
                    .join()
                    .timeout(const Duration(seconds: 7)),
              )
              as Map;
      final gifs = (decoded['data'] as List)
          .whereType<Map>()
          .map((gif) {
            final preview = gif['images']?['fixed_width_small_still']?['url'];
            return <String, dynamic>{
              'id': gif['id'],
              'title': gif['title'],
              'preview': preview,
            };
          })
          .where(
            (gif) =>
                RegExp(r'^[A-Za-z0-9]{1,48}$').hasMatch('${gif['id']}') &&
                RegExp(
                  r'^https://media\d*\.giphy\.com/',
                ).hasMatch('${gif['preview']}'),
          )
          .toList();
      if (mounted && generation == _queryVersion) setState(() => _gifs = gifs);
    } catch (_) {
      if (mounted && generation == _queryVersion)
        setState(() => _error = 'GIF search is unavailable. Try again.');
    } finally {
      if (mounted && generation == _queryVersion)
        setState(() => _loading = false);
    }
  }

  void _action(String action, String id) {
    if (action == 'emoji') {
      setState(() {
        _recent.remove(id);
        _recent.insert(0, id);
      });
      widget.onAction(action, id);
      return;
    }
    widget.onAction(action, id);
    Navigator.of(context).pop();
  }

  Future<void> _menu(Map<String, String> items, String id) async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final item in items.entries)
              ListTile(
                title: Text(item.value),
                onTap: () => Navigator.pop(sheet, item.key),
              ),
          ],
        ),
      ),
    );
    if (selected != null && mounted) _action(selected, id);
  }

  Widget _preview(String? value, String? glyph) {
    final fallback = Center(
      child: Text(glyph ?? '✦', style: const TextStyle(fontSize: 29)),
    );
    if (value == null || value.isEmpty) return fallback;
    if (value.startsWith('https://'))
      return Image.network(
        value,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => fallback,
      );
    try {
      final data = _images.putIfAbsent(
        value,
        () => base64Decode(value.split(',').last),
      );
      return Image.memory(
        data,
        fit: BoxFit.contain,
        errorBuilder: (_, _, _) => fallback,
      );
    } catch (_) {
      return fallback;
    }
  }

  Widget _grid(List<Widget> entries, int columns, {double ratio = 1}) =>
      GridView.count(
        crossAxisCount: columns,
        childAspectRatio: ratio,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisSpacing: 5,
        mainAxisSpacing: 5,
        padding: const EdgeInsets.fromLTRB(10, 2, 10, 8),
        children: entries,
      );

  Widget _tile(
    String label,
    Widget preview,
    VoidCallback tap, {
    VoidCallback? hold,
  }) => Semantics(
    button: true,
    label: label,
    child: Material(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(onTap: tap, onLongPress: hold, child: preview),
    ),
  );

  Widget _label(String label) => Padding(
    padding: const EdgeInsets.fromLTRB(14, 8, 12, 6),
    child: Text(label, style: Theme.of(context).textTheme.labelLarge),
  );

  List<Widget> _emoji() {
    final categories = _maps('categories'),
        query = _input.text.trim().toLowerCase();
    final entries = query.isEmpty
        ? (categories[_category]['items'] as List)
        : categories
              .expand((category) => category['items'] as List)
              .where(
                (item) =>
                    (item as List).join(' ').toLowerCase().contains(query),
              )
              .take(180)
              .toList();
    Widget symbol(String glyph, String label) =>
        _tile(label, _preview(null, glyph), () => _action('emoji', glyph));
    return [
      if (query.isEmpty)
        SizedBox(
          height: 42,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 9),
            children: [
              for (final (index, category) in categories.indexed)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: ChoiceChip(
                    label: Text('${category['icon']} ${category['name']}'),
                    selected: index == _category,
                    onSelected: (_) => setState(() => _category = index),
                  ),
                ),
            ],
          ),
        ),
      if (query.isEmpty && _recent.isNotEmpty) ...[
        _label('Recently used'),
        _grid(_recent.take(8).map((glyph) => symbol(glyph, glyph)).toList(), 8),
      ],
      if (entries.isEmpty) _label('No emoji found.'),
      _grid(
        entries
            .map<Widget>((item) => symbol(item[0] as String, item[1] as String))
            .toList(),
        8,
      ),
    ];
  }

  List<Widget> _stickers() {
    final custom = {
      for (final entry in _maps('stickers')) entry['id'] as String: entry,
    };
    final builtIn = _strings('pack'),
        favorites = _strings('favorites'),
        recent = _strings('stickersRecent');
    final names = Map<String, dynamic>.from(
      widget.model['packNames'] as Map? ?? {},
    );
    final query = _input.text.trim().toLowerCase();
    const collections = ['Recent', 'Favorites', 'My Stickers', 'Packs'];
    final collection = switch (_stickerSection) {
      'Recent' => recent,
      'Favorites' => favorites,
      'Packs' => builtIn,
      _ =>
        custom.entries
            .where((entry) => entry.value['favoriteOnly'] != true)
            .map((entry) => entry.key)
            .toList(),
    };
    Widget tile(String id) {
      final item = custom[id];
      return _tile(
        item?['label'] as String? ?? names[id] as String? ?? id,
        _preview(
          item?['preview'] as String?,
          item?['glyph'] as String? ?? (item == null ? id : null),
        ),
        () => _action('sendSticker', id),
        hold: () => _menu({
          'favorite': favorites.contains(id)
              ? 'Remove from Favorites'
              : 'Mark as favorite',
          if (item != null && item['favoriteOnly'] != true)
            'delete': 'Delete from My Stickers',
        }, id),
      );
    }

    final shown = collection.where((id) {
      final item = custom[id];
      if (item == null && !builtIn.contains(id)) return false;
      return query.isEmpty ||
          '$id ${item?['label'] ?? names[id]} ${item?['glyph'] ?? ''}'
              .toLowerCase()
              .contains(query);
    }).toList();

    return [
      SizedBox(
        height: 50,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          children: [
            for (final section in collections)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ChoiceChip(
                  label: Text(section),
                  selected: section == _stickerSection,
                  onSelected: (_) => setState(() => _stickerSection = section),
                ),
              ),
          ],
        ),
      ),
      if (_stickerSection == 'My Stickers')
        Align(
          alignment: Alignment.centerLeft,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: FilledButton.tonalIcon(
              icon: const Icon(Icons.add_rounded),
              label: const Text('Create sticker'),
              onPressed: () => _action('create', ''),
            ),
          ),
        ),
      if (_stickerSection == 'Packs') _label('Orbit Essentials'),
      if (shown.isEmpty)
        _label(query.isEmpty ? 'Nothing here yet.' : 'No matching stickers.'),
      if (shown.isNotEmpty) _grid(shown.map(tile).toList(), 5),
    ];
  }

  List<Widget> _gif() {
    final remote = _gifKey != null, query = _input.text.trim().toLowerCase();
    final rows = remote
        ? _gifs
        : _maps('loops')
              .where(
                (item) =>
                    (item['title'] as String).toLowerCase().contains(query),
              )
              .toList();
    return [
      _label(remote ? 'Powered by GIPHY' : 'Orbit GIFs'),
      if (_loading) const LinearProgressIndicator(),
      if (_error != null)
        TextButton(onPressed: _searchGiphy, child: Text(_error!)),
      if (rows.isEmpty && !_loading && _error == null) _label('No GIFs found.'),
      if (!_loading && _error == null)
        _grid(
          rows.map((row) {
            final id = row['id'] as String;
            return _tile(
              row['title'] as String? ?? 'GIF',
              _preview(row['preview'] as String?, null),
              () => _action(remote ? 'sendGiphy' : 'sendGif', id),
              hold: remote
                  ? null
                  : () => _menu({'saveGif': 'Save as sticker'}, id),
            );
          }).toList(),
          3,
          ratio: 1.13,
        ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xff8067e3),
      brightness: _isLight ? Brightness.light : Brightness.dark,
    );
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    final height = math.min(
      424.0,
      math.max(200.0, MediaQuery.sizeOf(context).height - keyboard - 90),
    );
    return Theme(
      data: ThemeData(colorScheme: scheme, useMaterial3: true),
      child: Padding(
        padding: EdgeInsets.only(bottom: keyboard),
        child: Material(
          color: scheme.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          child: SafeArea(
            top: false,
            child: SizedBox(
              height: height,
              child: Column(
                children: [
                  const SizedBox(height: 8),
                  Container(
                    width: 32,
                    height: 4,
                    decoration: BoxDecoration(
                      color: scheme.outlineVariant,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
                    child: TextField(
                      controller: _input,
                      autofocus: false,
                      onChanged: (_) {
                        if (_tab == 'gif' && _gifKey != null) {
                          _debounce?.cancel();
                          _queryVersion++;
                          _debounce = Timer(
                            const Duration(milliseconds: 290),
                            _searchGiphy,
                          );
                        } else {
                          setState(() {});
                        }
                      },
                      decoration: InputDecoration(
                        hintText: switch (_tab) {
                          'gif' => 'Search GIFs',
                          'stickers' => 'Search stickers',
                          _ => 'Search emoji',
                        },
                        prefixIcon: const Icon(Icons.search_rounded),
                        filled: true,
                        isDense: true,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(18),
                          borderSide: BorderSide.none,
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: ListView(
                      key: ValueKey(_tab),
                      padding: const EdgeInsets.only(top: 5),
                      children: switch (_tab) {
                        'gif' => _gif(),
                        'stickers' => _stickers(),
                        _ => _emoji(),
                      },
                    ),
                  ),
                  NavigationBar(
                    height: 59,
                    selectedIndex: const [
                      'emoji',
                      'gif',
                      'stickers',
                    ].indexOf(_tab),
                    onDestinationSelected: (index) =>
                        _select(const ['emoji', 'gif', 'stickers'][index]),
                    destinations: const [
                      NavigationDestination(
                        icon: Icon(Icons.mood_rounded),
                        label: 'Emoji',
                      ),
                      NavigationDestination(
                        icon: Icon(Icons.gif_box_outlined),
                        label: 'GIF',
                      ),
                      NavigationDestination(
                        icon: Icon(Icons.sticky_note_2_outlined),
                        label: 'Stickers',
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
