package github

type TriggerHandler interface {
	CurrentRunnerCount() (int, error)
	TriggerNewRunners(jitConfigs []string) error
	NeededRunners(jitConfigs []string) error
}
