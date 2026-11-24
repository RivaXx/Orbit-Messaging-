import 'package:flutter/material.dart';

class OrbitIncomingCall extends StatelessWidget {
  const OrbitIncomingCall({
    super.key,
    required this.title,
    required this.full,
    required this.onAction,
  });

  final String title;
  final bool full;
  final ValueChanged<String> onAction;

  Widget _action(String label, IconData icon, Color color, String action) =>
      Semantics(
        button: true,
        label: label,
        child: IconButton.filled(
          tooltip: label,
          onPressed: () => onAction(action),
          style: IconButton.styleFrom(
            backgroundColor: color,
            foregroundColor: Colors.white,
            minimumSize: const Size(48, 48),
          ),
          icon: Icon(icon),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final answer = _action(
      'Answer Orbit call',
      Icons.call_rounded,
      const Color(0xff18794e),
      'answer',
    );
    final decline = _action(
      'Decline Orbit call',
      Icons.call_end_rounded,
      const Color(0xffba354c),
      'decline',
    );
    final avatar = CircleAvatar(
      radius: full ? 48 : 24,
      backgroundColor: const Color(0xff593fa2),
      child: Icon(
        Icons.person_rounded,
        color: const Color(0xfff5efff),
        size: full ? 48 : 25,
      ),
    );
    if (full) {
      return Positioned.fill(
        child: Material(
          color: const Color(0xff121323),
          child: Semantics(
            scopesRoute: true,
            namesRoute: true,
            label: 'Incoming Orbit call',
            child: Padding(
              padding: const EdgeInsets.fromLTRB(28, 36, 28, 42),
              child: Column(
                children: [
                  const Spacer(),
                  avatar,
                  const SizedBox(height: 24),
                  Text(
                    title,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 34,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'Incoming Orbit voice call',
                    style: TextStyle(color: Color(0xffc7c0e3), fontSize: 16),
                  ),
                  const Spacer(flex: 2),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      Column(
                        children: [
                          decline,
                          const SizedBox(height: 8),
                          const Text('Decline'),
                        ],
                      ),
                      Column(
                        children: [
                          answer,
                          const SizedBox(height: 8),
                          const Text('Answer'),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }
    return Positioned(
      top: 8,
      left: 12,
      right: 12,
      child: Material(
        elevation: 12,
        borderRadius: BorderRadius.circular(24),
        color: const Color(0xff1b1930),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
          child: Row(
            children: [
              avatar,
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text(
                      'Orbit voice call',
                      style: TextStyle(fontSize: 11, color: Color(0xffc7c0e3)),
                    ),
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 16,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
              ),
              decline,
              const SizedBox(width: 6),
              answer,
            ],
          ),
        ),
      ),
    );
  }
}
