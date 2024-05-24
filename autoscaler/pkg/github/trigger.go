package github

type TriggerHandler interface {
	CurrentRunnerCount() (int, error)
	TriggerNewRunners(count int, jitConfig string) error
	NeededRunners(count int, jitConfig string) error
}
